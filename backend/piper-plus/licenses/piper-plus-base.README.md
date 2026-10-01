---
license: cc-by-4.0
language:
- ja
- en
- zh
- es
- fr
- pt
pipeline_tag: text-to-speech
tags:
- tts
- vits
- multilingual
- piper
- text-to-speech
---

# Piper Plus Base Model (Multilingual 6-Language) — MB-iSTFT-VITS2

6言語対応 TTS の事前学習済みベースモデルです。ファインチューニング用のチェックポイントとして提供しています。Decoder は **MB-iSTFT (Multi-Band inverse STFT) + PQMF** に統一済みで、HiFi-GAN ベースの旧モデルから置き換えられています。prosody_features (A1/A2/A3) に対応しています。

> ⚠️ **Breaking change (2026-05)**: このモデルは MB-iSTFT-VITS2 アーキテクチャで再学習された新世代版です。**旧 HiFi-GAN ベースの ckpt から `--resume_from_checkpoint` で本モデルにつなぐことは出来ません**。逆に本モデルを base にした FT は piper-plus PR #320 以降の最新コードでのみ動作します。詳しくは [piper-plus PR #320](https://github.com/ayutaz/piper-plus/pull/320) / [Issue #268](https://github.com/ayutaz/piper-plus/issues/268)。

## Model Details

| 項目 | 値 |
|------|-----|
| アーキテクチャ | VITS (Decoder: **MB-iSTFT + PQMF**) |
| 言語 | 日本語 (ja), 英語 (en), 中国語 (zh), スペイン語 (es), フランス語 (fr), ポルトガル語 (pt) |
| サンプルレート | 22050 Hz |
| 品質 | medium |
| 音素タイプ | multilingual |
| 話者数 | 0 (ファインチューニング用: 元モデルは571話者から学習) |
| 言語数 | 6 |
| **prosody_dim** | **16** |
| 音素数 | 173 |
| Decoder upsample | `(4, 4) × iSTFT(4) × PQMF(4) = 256x` |
| 学習 epoch | 75 (スクラッチ学習) |

## Features

### MB-iSTFT-VITS2 Decoder

VITS の Decoder を Multi-Band iSTFT + PQMF に置き換えたバージョン。HiFi-GAN Generator を完全に廃止し、トータルの upsample 倍率 256x を維持しつつ Decoder の計算コストを大幅削減。

| メトリック | 旧 HiFi-GAN | **MB-iSTFT (本モデル)** | 改善 |
|-----------|-----------|----------------------|------|
| CPU ONNX p50 (100 phoneme) | 168.2 ms | **76.2 ms** | **2.21x** |
| Decoder 単体 | — | — | **~3.6x** (論文値と同等) |
| 出力形状 | `[B, 1, T]` | `[B, 1, T]` | 変化なし (ランタイム互換) |

C++/Rust/C#/Go/WASM ランタイム側は **修正不要** で本モデルを使用できます (出力形状互換のため)。

### 6言語対応

`MultilingualPhonemizer` により、文内コードスイッチング（言語混合テキスト）に対応:

| 言語 | コード | language_id | Phonemizer |
|------|--------|-------------|------------|
| 日本語 | ja | 0 | JapanesePhonemizer (pyopenjtalk) |
| 英語 | en | 1 | EnglishPhonemizer (g2p-en) |
| 中国語 | zh | 2 | ChinesePhonemizer (pypinyin) |
| スペイン語 | es | 3 | SpanishPhonemizer (規則ベース) |
| フランス語 | fr | 4 | FrenchPhonemizer (規則ベース) |
| ポルトガル語 | pt | 5 | PortuguesePhonemizer (規則ベース) |

### Prosody Features (A1/A2/A3)

OpenJTalk から抽出されるプロソディ特徴量をサポート:

| フィールド | 意味 | 値の例 |
|----------|------|--------|
| A1 | アクセント核からの相対位置 | -4, -3, ..., 0, 1, ... |
| A2 | アクセント句内のモーラ位置 | 1, 2, 3, ... |
| A3 | アクセント句内の総モーラ数 | 1-10+ |

### 拡張音素

- 疑問詞マーカー: `?!`, `?.`, `?~`
- 文脈依存「ん」バリアント: `N_m`, `N_n`, `N_ng`, `N_uvular`

## Usage

### シングル話者ファインチューニング (推奨)

```bash
# Step 1: データセット前処理
uv run python -m piper_train.preprocess \
  --input-dir /path/to/your-ljspeech-data \
  --output-dir /path/to/dataset \
  --language ja \
  --dataset-format ljspeech \
  --sample-rate 22050 \
  --single-speaker \
  --phoneme-type multilingual

# Step 2: Prosody Features 追加 (日本語の場合、推奨)
uv run python add_prosody_features.py \
  --input-dataset /path/to/dataset/dataset.jsonl \
  --output-dir /path/to/dataset-prosody \
  --workers 4

# Step 3: ファインチューニング
uv run python -m piper_train \
  --dataset-dir /path/to/dataset-prosody \
  --prosody-dim 16 \
  --accelerator gpu \
  --devices 1 \
  --precision 32-true \
  --max_epochs 500 \
  --batch-size 4 \
  --samples-per-speaker 4 \
  --checkpoint-epochs 50 \
  --base_lr 2e-5 \
  --disable_auto_lr_scaling \
  --ema-decay 0.9995 \
  --max-phoneme-ids 400 \
  --no-wavlm \
  --resume-from-multispeaker-checkpoint /path/to/model.ckpt \
  --default_root_dir /path/to/output
```

`--resume-from-multispeaker-checkpoint` は以下を自動的に行います:
- `emb_g` (話者埋め込み) の処理
- `emb_lang` への conditioning 分布補正
- `--freeze-dp` の自動有効化 (Duration Predictor の catastrophic forgetting 防止)

### マルチ話者ファインチューニング

```bash
uv run python -m piper_train \
  --dataset-dir /path/to/multi-speaker-dataset \
  --prosody-dim 16 \
  --accelerator gpu \
  --devices 4 \
  --precision 32-true \
  --max_epochs 150 \
  --batch-size 20 \
  --samples-per-speaker 2 \
  --base_lr 2e-4 \
  --disable_auto_lr_scaling \
  --ema-decay 0.9995 \
  --max-phoneme-ids 400 \
  --no-wavlm \
  --resume_from_checkpoint /path/to/model.ckpt \
  --default_root_dir /path/to/output
```

### ONNX Export

MB-iSTFT モデルでもエクスポート手順は変わりません (Decoder は ONNX 互換 iSTFT 経由で展開):

```bash
CUDA_VISIBLE_DEVICES="" uv run python -m piper_train.export_onnx \
  /path/to/checkpoint.ckpt \
  /path/to/output.onnx
```

FP16 変換がデフォルト (モデルサイズ ~50% 削減)。FP32 が必要な場合は `--no-fp16` を指定。

### 推論

```bash
CUDA_VISIBLE_DEVICES="" uv run python -m piper_train.infer_onnx \
  --model /path/to/output.onnx \
  --config /path/to/config.json \
  --output-dir /path/to/output \
  --text "こんにちは、今日は良い天気ですね。" \
  --language ja-en-zh-es-fr-pt \
  --speaker-id 0 --noise-scale 0.667
```

## Recommended Parameters

### シングル話者ファインチューニング

| パラメータ | 値 | 説明 |
|----------|-----|------|
| `--base_lr` | 2e-5 | 事前学習の 1/10 (過学習防止) |
| `--max_epochs` | 500 | 小規模データ (100 発話) の場合 |
| `--batch-size` | 4 | 小規模データセット向け |
| `--freeze-dp` | 自動 | `--resume-from-multispeaker-checkpoint` 使用時 |
| `--precision` | 32-true | V100 GPU 推奨 (FP16 は backward 遅延あり) |
| `--no-wavlm` | - | ファインチューニング時は不要 |

### emb_lang 後処理 (シングル話者 FT 後)

シングル話者ファインチューニング後、ONNX エクスポート前に `emb_lang[0]` を他の全言語スロットにコピーすることを推奨します (export_onnx が自動実行):

```bash
CUDA_VISIBLE_DEVICES="" uv run python -m piper_train.export_onnx \
  --unify-emb-lang \
  /path/to/checkpoint.ckpt \
  /path/to/output.onnx
```

`--unify-emb-lang` は `num_speakers <= 1 and num_languages > 1` で自動有効化されるので通常は明示不要です。

## Origin

このベースモデルは以下のデータから学習されました:

| 言語 | 話者数 | 発話数 | ソース |
|------|--------|--------|--------|
| ja | 20 | 60,148 | MOE-Speech |
| en | 310 | 74,912 | LibriTTS-R |
| zh | 142 | 63,223 | AISHELL-3 (Apache-2.0) |
| es | 63 | 168,374 | CML-TTS Spanish (CC-BY-4.0) |
| fr | 28 | 107,464 | CML-TTS French (CC-BY-4.0) |
| pt | 8 | 34,066 | CML-TTS Portuguese (CC-BY-4.0) |
| **合計** | **571** | **508,187** | |

- **アーキテクチャ**: MB-iSTFT-VITS2 (Decoder: Multi-Band inverse STFT + PQMF, upsample (4,4) × 4 × 4 = 256x)
- **学習設定**: 75 epoch, batch-size 20, 4 GPU (V100 16GB), prosody_dim=16
- **gradient steps**: ~282K
- **学習形態**: スクラッチ学習 (HiFi-GAN ベースからの転移ではない)
- `emb_g` (話者埋め込み) は除去済み、optimizer states は除去済み

## Files

- `model.ckpt` - PyTorch Lightning チェックポイント (EMA state 含む、`emb_g` / optimizer 除去済み)
- `config.json` - モデル設定 (173 音素マップ、6 言語、prosody 設定、`num_speakers=0`)
- `voice/mei_normal.htsvoice` - OpenJTalk 日本語音素化用 voice ファイル

## Citation

```bibtex
@software{piper_plus,
  title = {Piper Plus: Multilingual TTS with VITS, Prosody Features, MB-iSTFT Decoder},
  author = {ayousanz},
  year = {2024},
  url = {https://github.com/ayutaz/piper-plus}
}
```

## References

- MB-iSTFT-VITS: [Kawamura et al., 2023](https://arxiv.org/abs/2210.15975)
- VITS: [Kim et al., 2021](https://arxiv.org/abs/2106.06103)
- piper-plus PR #320 (本モデルのリリース): [GitHub](https://github.com/ayutaz/piper-plus/pull/320)
