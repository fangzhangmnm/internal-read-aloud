/* ojt_wasm.c — thin C entry points over the OpenJTalk text frontend bundled in pyopenjtalk-plus 0.4.1.post9
 * (tsukumijima/open_jtalk fork), for building to WebAssembly.
 * created 2026-10-01 by Claude Fable 5.1
 *
 * The three stages mirror pyopenjtalk-plus' Cython wrapper (pyopenjtalk/openjtalk.pyx) exactly, so that the Python-side
 * rule passes can be re-implemented in JS between them:
 *   stage1: text2mecab -> MeCab -> drop "記号,空白" morphs -> mecab2njd -> njd_set_pronunciation        (_run_mecab + first half of _run_njd_from_mecab)
 *           [JS: apply_original_rule_before_chaining]
 *   stage2: njd_set_digit -> accent_phrase -> accent_type -> unvoiced_vowel -> long_vowel               (second half of _run_njd_from_mecab)
 *           [JS: apply_postprocessing]
 *   labels: njd2jpcommon -> JPCommon_make_label                                                         (make_label)
 * NJD nodes cross the boundary as text: one node per line, 14 tab-separated fields
 *   string pos pos_group1 pos_group2 pos_group3 ctype cform orig read pron acc mora_size chain_rule chain_flag
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>

#include "mecab.h"
#include "njd.h"
#include "jpcommon.h"
#include "text2mecab.h"
#include "mecab2njd.h"
#include "njd_set_pronunciation.h"
#include "njd_set_digit.h"
#include "njd_set_accent_phrase.h"
#include "njd_set_accent_type.h"
#include "njd_set_unvoiced_vowel.h"
#include "njd_set_long_vowel.h"
#include "njd2jpcommon.h"

#define TEXT2MECAB_BUFFER_SIZE 16384   /* same as openjtalk.pyx */

static Mecab g_mecab;
static NJD g_njd;
static JPCommon g_jpcommon;
static int g_ready = 0;
static char *g_out = NULL;
static size_t g_cap = 0, g_len = 0;

static void out_reset(void) { g_len = 0; if (g_out) g_out[0] = '\0'; }
static void out_add(const char *s) {
  size_t n = strlen(s);
  if (g_len + n + 1 > g_cap) { g_cap = (g_len + n + 1) * 2 + 1024; g_out = (char *) realloc(g_out, g_cap); }
  memcpy(g_out + g_len, s, n + 1); g_len += n;
}
static const char *nz(const char *s) { return s ? s : ""; }

static void njd_serialize(NJD *njd) {
  char num[32]; NJDNode *node;
  out_reset();
  for (node = njd->head; node != NULL; node = node->next) {
    out_add(nz(NJDNode_get_string(node))); out_add("\t");
    out_add(nz(NJDNode_get_pos(node))); out_add("\t");
    out_add(nz(NJDNode_get_pos_group1(node))); out_add("\t");
    out_add(nz(NJDNode_get_pos_group2(node))); out_add("\t");
    out_add(nz(NJDNode_get_pos_group3(node))); out_add("\t");
    out_add(nz(NJDNode_get_ctype(node))); out_add("\t");
    out_add(nz(NJDNode_get_cform(node))); out_add("\t");
    out_add(nz(NJDNode_get_orig(node))); out_add("\t");
    out_add(nz(NJDNode_get_read(node))); out_add("\t");
    out_add(nz(NJDNode_get_pron(node))); out_add("\t");
    snprintf(num, sizeof num, "%d\t", NJDNode_get_acc(node)); out_add(num);
    snprintf(num, sizeof num, "%d\t", NJDNode_get_mora_size(node)); out_add(num);
    out_add(nz(NJDNode_get_chain_rule(node))); out_add("\t");
    snprintf(num, sizeof num, "%d\n", NJDNode_get_chain_flag(node)); out_add(num);
  }
}

/* feature2njd(): rebuild the NJD list from the text form. Modifies `tsv` in place. */
static int njd_deserialize(NJD *njd, char *tsv) {
  char *line = tsv;
  while (line && *line) {
    char *nl = strchr(line, '\n'); char *f[14]; int i; char *p = line; NJDNode *node;
    if (nl) *nl = '\0';
    for (i = 0; i < 14; i++) { f[i] = p; if (i < 13) { char *t = strchr(p, '\t'); if (!t) return 0; *t = '\0'; p = t + 1; } }
    node = (NJDNode *) calloc(1, sizeof(NJDNode));
    if (!node) return 0;
    NJDNode_initialize(node);
    NJDNode_set_string(node, f[0]); NJDNode_set_pos(node, f[1]); NJDNode_set_pos_group1(node, f[2]); NJDNode_set_pos_group2(node, f[3]);
    NJDNode_set_pos_group3(node, f[4]); NJDNode_set_ctype(node, f[5]); NJDNode_set_cform(node, f[6]); NJDNode_set_orig(node, f[7]);
    NJDNode_set_read(node, f[8]); NJDNode_set_pron(node, f[9]); NJDNode_set_acc(node, atoi(f[10])); NJDNode_set_mora_size(node, atoi(f[11]));
    NJDNode_set_chain_rule(node, f[12]); NJDNode_set_chain_flag(node, atoi(f[13]));
    NJD_push_node(njd, node);
    line = nl ? nl + 1 : NULL;
  }
  return 1;
}

EMSCRIPTEN_KEEPALIVE int ojt_init(const char *dicdir) {
  if (g_ready) return 1;
  Mecab_initialize(&g_mecab); NJD_initialize(&g_njd); JPCommon_initialize(&g_jpcommon);
  if (Mecab_load(&g_mecab, dicdir) != 1) { Mecab_clear(&g_mecab); return 0; }
  g_ready = 1; return 1;
}

/* returns NULL on failure (text too long / mecab failure) */
EMSCRIPTEN_KEEPALIVE const char *ojt_stage1(const char *text) {
  static char buff[TEXT2MECAB_BUFFER_SIZE];
  int size, i, n = 0; char **feat; char **kept;
  if (!g_ready) return NULL;
  if (text2mecab(buff, TEXT2MECAB_BUFFER_SIZE, text) != 0) return NULL;
  if (Mecab_analysis(&g_mecab, buff) != 1) { Mecab_refresh(&g_mecab); return NULL; }
  size = Mecab_get_size(&g_mecab); feat = Mecab_get_feature(&g_mecab);
  out_reset();
  if (size > 0 && feat != NULL) {
    kept = (char **) malloc(sizeof(char *) * (size_t) size);
    for (i = 0; i < size; i++) if (feat[i] && strstr(feat[i], "記号,空白") == NULL) kept[n++] = feat[i];   /* pyopenjtalk-plus filter */
    if (n > 0) {
      mecab2njd(&g_njd, kept, n);
      njd_set_pronunciation(&g_njd);
      njd_serialize(&g_njd);
    }
    free(kept);
  }
  NJD_refresh(&g_njd); Mecab_refresh(&g_mecab);
  return g_out ? g_out : "";
}

EMSCRIPTEN_KEEPALIVE const char *ojt_stage2(char *tsv) {
  if (!g_ready) return NULL;
  if (!njd_deserialize(&g_njd, tsv)) { NJD_refresh(&g_njd); return NULL; }
  njd_set_digit(&g_njd);
  njd_set_accent_phrase(&g_njd);
  njd_set_accent_type(&g_njd);
  njd_set_unvoiced_vowel(&g_njd);
  njd_set_long_vowel(&g_njd);
  njd_serialize(&g_njd);
  NJD_refresh(&g_njd);
  return g_out ? g_out : "";
}

EMSCRIPTEN_KEEPALIVE const char *ojt_labels(char *tsv) {
  int i, size; char **lab;
  if (!g_ready) return NULL;
  if (!njd_deserialize(&g_njd, tsv)) { NJD_refresh(&g_njd); return NULL; }
  njd2jpcommon(&g_jpcommon, &g_njd);
  JPCommon_make_label(&g_jpcommon);
  size = JPCommon_get_label_size(&g_jpcommon); lab = JPCommon_get_label_feature(&g_jpcommon);
  out_reset();
  for (i = 0; i < size && lab; i++) { out_add(nz(lab[i])); out_add("\n"); }
  JPCommon_refresh(&g_jpcommon); NJD_refresh(&g_njd);
  return g_out ? g_out : "";
}
