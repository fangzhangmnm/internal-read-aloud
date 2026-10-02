# LICENSES — what must ship with the piper-plus つくよみちゃん backend

> created 2026-10-01 by Claude Fable 5.1 · as-of: files listed in `pack-layout.json`, terms pages fetched 2026-10-01
> This is a collection of the upstream licence texts plus my reading of what they require. It is not legal advice.
> Verbatim copies of every text are in `licenses/`.

## 1. Summary

| what ships | licence | obligation |
|---|---|---|
| `model.onnx`, `config.json` (voice) | つくよみちゃんコーパス利用規約 (model card `ayousanz/piper-plus-tsukuyomi-chan`: `license: other`, `license_name: tsukuyomi-chan-corpus`) | **credit block in the product UI is mandatory** — §2 |
| base model the voice was fine-tuned from (`ayousanz/piper-plus-base`) | CC-BY-4.0 | attribution line — §3 |
| `ja/sys.dic`, `ja/matrix.bin`, `ja/char.bin`, `ja/unk.dic` | BSD-3-Clause style ×3 (NAIST, UniDic Consortium, Open JTalk) | reproduce the notice — §4.1 |
| `ja/ojt.wasm`, `vendor/ojt/ojt.mjs` | Open JTalk (Modified BSD), MeCab (BSD; offered under GPL / LGPL / BSD, BSD chosen), pyopenjtalk / pyopenjtalk-plus (MIT) | reproduce the notices — §4.2–4.4 |
| `ja/nani-model.json`, `ja-frontend.js` (ported rule passes) | pyopenjtalk-plus (MIT) | §4.4 |
| `en/cmudict_data.json` | CMU Pronouncing Dictionary (BSD-2-Clause style) | reproduce the notice — §4.5 |
| `en/homographs.json` | g2p-en (Apache-2.0) | ship the licence text, state that the file was converted — §4.6 |
| `zh/pinyin_*.tone3.json` | pypinyin / pinyin-data / phrase-pinyin-data (MIT) | §4.7 |
| `ort-wasm-simd-threaded.wasm`, `vendor/onnxruntime-web/*` | onnxruntime (MIT) | §4.8 |
| `encode.js`, `en-g2p.js`, `zh-g2p.js`, `pua-map.js` (ports of piper-plus code); `zh-loanwords.js` (data copied from piper-plus `data/zh_en_loanword.json`, 2026-10-01) | piper-plus (MIT) | §4.9 |

## 2. つくよみちゃんコーパス — the credit block (mandatory)

Source: https://tyc.rei-yumesaki.net/material/corpus/ (section 「③声質を使用した音声合成ソフト等を公開する」), snapshot in
`licenses/tsukuyomi-chan-corpus.terms-page-snapshot-20261001.txt`.

What the page says, in short (my reading — read the original below):

1. Publishing software, an acoustic model or an API that lets third parties use this voice is allowed — free or paid, app or web —
   **with a credit**.
2. Either agree on the credit wording with 夢前黎 by e-mail before release, **or** show the text below "in a conspicuous place at a
   sufficient font size"; then no contact is needed.
3. The four prohibited uses of the generated speech must be part of the product's terms (otherwise ask first).
4. A paid product must show the text where it can be read before paying.
5. If users may modify or redistribute the software or the model, they must be bound to the corpus terms for the part derived from
   the corpus (this passes on to derivatives).
6. The product name must not collide with existing つくよみちゃん speech software or 「つくよみちゃんボイス」.
7. Do not use the voice data to build speech software for a different character without asking.
8. Whether users of the product must credit anything in *their* works is the developer's choice.

Text to display — the page's wording with its inline editorial notes ("←…") and the two lines that are only needed when the
character design is used (illustration credit, official-site link) left out:

```text
本ソフトウェアの音声合成には、フリー素材キャラクター「つくよみちゃん」（© Rei Yumesaki）が無料公開している音声データを使用しています。
■つくよみちゃんコーパス（CV.夢前黎）
https://tyc.rei-yumesaki.net/material/corpus/

つくよみちゃんの声質を使用する場合は、出力した音声を次の目的で使用することを禁止します。
【禁止事項】
■人を批判・攻撃すること。（「批判・攻撃」の定義は、つくよみちゃんキャラクターライセンスに準じます）
■特定の政治的立場・宗教・思想への賛同または反対を呼びかけること。
■刺激の強い表現をゾーニングなしで公開すること。
■他者に対して二次利用（素材としての利用）を許可する形で公開すること。
```

Section ③ of the terms page, verbatim (2026-10-01):

```text
③声質を使用した音声合成ソフト等を公開する
次のようなご利用も可能です。ただし、クレジット表記は必須です。
■つくよみちゃんコーパスの声質が使える文章読み上げソフト、声質変換ソフト、歌声合成ソフト、その他の音声合成ソフト等を公開する。（音響モデルやAPIの状態での公開など、つくよみちゃんコーパスの声質を第三者が利用できるようにする行為全般を含む）
■有料・無料、広告収入の有無、ユーザーに対して商用利用や成人向け表現を許可するかどうかを問わず可。
■PCソフト、スマホアプリ、WEBアプリ、その他いずれの形式でも可。
■つくよみちゃんがメインであるか、ソフト内で選べる複数の声質・キャラクターの中の１つに過ぎないかを問わず可。
万が一、適切なクレジット表記のないままソフトがリリースされてしまいますと、
つくよみちゃんがあなたのオリジナルキャラクターであると誤解される
つくよみちゃんコーパスが誰でも無料で利用できるものであることが伝わらなくなる
誰の声を元にしているか分からなくなる
といった問題が発生する恐れがございます。
そのため、リリース前に夢前黎にメールをお送りいただき、双方の合意の元で、クレジットの仕方について取り決めをさせていただければ幸いです。
▼クレジット表記＆簡易利用規約のテンプレート▼
音声合成ソフトのユーザーに対して、生成音声の使用時にクレジット表記を求めるかどうか（詳細は後述）によって、テンプレートを分けました。
クレジット表記を必須とする場合
クレジット表記を任意とする場合
クレジット表記を不要とする場合
しかし、夢前黎の死亡・傷病により連絡が取れなくなる可能性や、「公式のチェックを受けたくない」と感じる方がいらっしゃる可能性も考慮して、次の文面を目立つところに十分な文字サイズで掲載する場合は、ご連絡は不要といたします。
本ソフトウェアの音声合成には、フリー素材キャラクター「つくよみちゃん」（© Rei Yumesaki）が無料公開している音声データを使用しています。
■つくよみちゃんコーパス（CV.夢前黎）
https://tyc.rei-yumesaki.net/material/corpus/
■イラスト：○○様←つくよみちゃんのキャラクターデザインを使用していない場合は不要
URL（配布されている素材を使用した場合）
■つくよみちゃん公式サイト←同上
https://tyc.rei-yumesaki.net
つくよみちゃんの声質を使用する場合は、出力した音声を次の目的で使用することを禁止します。←または「キャラクター選択画面で「つくよみちゃん」を選択した場合は」など、ソフトウェア内での表記に合わせて適宜変更してください。つくよみちゃん以外の話者を選べない場合は「～の場合は」という仮定は不要です。下記の禁止事項はソフトウェア全体の利用規約として定めていただいても構いません。
【禁止事項】
■人を批判・攻撃すること。（「批判・攻撃」の定義は、つくよみちゃんキャラクターライセンスに準じます）
■特定の政治的立場・宗教・思想への賛同または反対を呼びかけること。
■刺激の強い表現をゾーニングなしで公開すること。
■他者に対して二次利用（素材としての利用）を許可する形で公開すること。
※先述のクレジット表記＆簡易利用規約のテンプレートもご活用ください。
※他の話者の声質とマージする場合は、その旨も説明してください。
※有料で公開する場合は、製品内だけでなく、料金を支払う前に確認できる場所にもこの文面を掲載する必要があります。
※つくよみちゃんのキャラクターデザインを使用している場合は、キャラクターについてのクレジットも必要となります。（2025.02.13追記：キャラクターデザインが同時に使用されることが多い実態を踏まえ、例文の段階でキャラクターについてのクレジット表記を含めるようにしました）
その他の利用規約は次の通りです。
音声合成ソフトの利用規約において、出力した音声を次の目的で使用することを禁止しない場合は、事前にご相談ください。
■人を批判・攻撃すること。（「批判・攻撃」の定義は、つくよみちゃんキャラクターライセンスに準じます）
■特定の政治的立場・宗教・思想への賛同または反対を呼びかけること。
■刺激の強い表現をゾーニングなしで公開すること。
■他者に対して二次利用（素材としての利用）を許可する形で公開すること。
※鑑賞用の作品として配布・販売していただくことは問題ございません。
声質のデータを、つくよみちゃん以外のキャラクターの音声合成ソフトの制作に無断で利用しないでください。そのようなご希望がある場合は、まずはご相談ください。
※過去の回答事例：An Example of the On-screen Credit Required When Using Synthesized Voice Based on Tsukuyomi-chan's Voice Quality as the Output for Another Character's Conversational AI Software （つくよみちゃんの声質を使用した合成音声を他のキャラクターの会話AIソフトの出力音声として使用する場合に必要な画面内クレジットの例）
音声合成ソフトから出力した音声を、つくよみちゃん以外のキャラクターの声として使用すること（アテレコ・吹き替え）は可能です。
音声合成ソフトのユーザーに対して、ソフト使用時にクレジット表記を義務付けるかどうかはあなたの自由です。
※つくよみちゃんキャラクターライセンスにおいては、つくよみちゃんのご利用時にはクレジットが必須であるとしておりますが、本件については例外といたします。音声合成ソフトのユーザーには「これはつくよみちゃんの声だ」と分かった上でご利用いただきたいですが、音声合成ソフトを使用して作られた作品の閲覧者にまで同じ理解を求めるかどうかについては、ソフトの開発者であるあなたの意向を尊重して自由とします。（参考：無料のキャラクターつき音声合成ソフトの場合、お金は取らない代わりに知名度を上げたいということで、ユーザーに対して「ソフト名＋キャラクター名」のクレジット表記を義務付ける運用が好まれる傾向にあるようです）
上記の特例により、音声合成ソフトから出力された音声にはクレジットの義務は発生しませんが、つくよみちゃんの他の素材は、それぞれの利用規約に基づいて使用されなければなりません。例えば、音声と一緒に立ち絵素材を使用した場合は、立ち絵素材の利用規約に基づきクレジットが必要になる場合がございます。
音声合成ソフトの利用規約は、本コーパスの利用規約に反しない範囲で、あなたが自由に設定することができます。例えば、あなたが「商用利用や法人での利用は禁止したい」と思えば、そのようにすることができます。
つくよみちゃんプロジェクトは、表現の自由を尊重しています。適切なゾーニングが実施されている限りにおいては、成人向け表現や残酷な表現についても制限を設けておりません。
音声合成ソフト（「ソースコードの一部のみ」「音響モデルのみ」等の状態も含む）の改変・再配布を許可する場合は、それを行うユーザーに対して「つくよみちゃんコーパスに由来する部分の取り扱いについてはつくよみちゃんコーパスの利用規約に従うこと」を義務付けてください。この規定は、派生ソフトや再配布されたデータにもコピーレフトされます。
音声合成ソフトの名称は、つくよみちゃんの声が使える既存の音声合成ソフトの名称及び「つくよみちゃんボイス」と被らないようにしてください。他者の商標権を侵害しないようにもご注意ください。
音声合成ソフトを販売する場合は、夢前黎には無料で提供していただけると嬉しいです。（強制ではありません）
夢前黎に音声の収録を依頼したい場合、共同開発やコラボレーションを希望される場合、監修が必要な場合、プロモーションへの協力を依頼したい場合は、こちらをご参照ください。
```

Section ⑤ (redistribution of the corpus itself / of generated speech as material), verbatim:

```text
⑤再配布したい／データを提供したい
■本品そのものの再配布は原則的には禁止です。第三者につくよみちゃんコーパスをダウンロードしてもらいたい時は、この配布ページ（ https://tyc.rei-yumesaki.net/material/corpus/ ）をご紹介ください。
■本品の声質を用いて合成された音声を、素材として配布・販売することも、原則的には禁止です。
■上記２点について、夢前黎から個別に許可を得たい場合は、メールでご相談ください。改変したものを再配布したい場合は、どのように改変したのかもお知らせください。
こちらから条件・料金等を提示させていただく場合や、ご期待に沿えない場合もございますことを、あらかじめご了承ください。
■もし、自作された資料・ラベル等の追加データをこちらのページで配布してほしいという方がいらっしゃいましたら、夢前黎にメールでご相談ください。
■例外として、次の場合は、改変の有無にかかわらず再配布が可能です。なお、再配布されるデータにも本規約が適用されます。
■本データがダウンロード不能な状態となっており、その旨を夢前黎に伝えようとしても連絡が取れず、夢前黎のネット上での活動も半年以上確認できなくなっている場合。
この場合は、「オリジナルの配布URLにアクセスできなくなっているため、利用規約に従って第三者が再配布している」ということを説明した上で、無料で再配布していただけます。データに改変がある場合は、その旨もご説明ください。その後夢前黎が復活し、再配布の終了をお願いした場合は、その指示に従ってください。
```

## 3. Base model — CC-BY-4.0

`ayousanz/piper-plus-base` (https://huggingface.co/ayousanz/piper-plus-base), model card `license: cc-by-4.0`. Suggested attribution:

```text
Voice model fine-tuned by ayousanz (https://huggingface.co/ayousanz/piper-plus-tsukuyomi-chan) from piper-plus-base (https://huggingface.co/ayousanz/piper-plus-base, CC BY 4.0), built with Piper Plus (https://github.com/ayutaz/piper-plus).
```

The base model card lists its training data as: MOE-Speech (ja), LibriTTS-R (en), AISHELL-3 (zh, Apache-2.0), CML-TTS Spanish / French /
Portuguese (CC-BY-4.0).

## 4. Licence texts (verbatim)

### 4.1 Japanese dictionary (`pyopenjtalk/dictionary/COPYING` from pyopenjtalk-plus 0.4.1.post9)

```text
Copyright (c) 2009, Nara Institute of Science and Technology, Japan.

All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

Redistributions of source code must retain the above copyright notice,
this list of conditions and the following disclaimer.
Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.
Neither the name of the Nara Institute of Science and Technology
(NAIST) nor the names of its contributors may be used to endorse or
promote products derived from this software without specific prior
written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

Copyright (c) 2011-2017, The UniDic Consortium
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

 * Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.

 * Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the
   distribution.

 * Neither the name of the UniDic Consortium nor the names of its
   contributors may be used to endorse or promote products derived
   from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

/* ----------------------------------------------------------------- */
/*           The Japanese TTS System "Open JTalk"                    */
/*           developed by HTS Working Group                          */
/*           http://open-jtalk.sourceforge.net/                      */
/* ----------------------------------------------------------------- */
/*                                                                   */
/*  Copyright (c) 2008-2016  Nagoya Institute of Technology          */
/*                           Department of Computer Science          */
/*                                                                   */
/* All rights reserved.                                              */
/*                                                                   */
/* Redistribution and use in source and binary forms, with or        */
/* without modification, are permitted provided that the following   */
/* conditions are met:                                               */
/*                                                                   */
/* - Redistributions of source code must retain the above copyright  */
/*   notice, this list of conditions and the following disclaimer.   */
/* - Redistributions in binary form must reproduce the above         */
/*   copyright notice, this list of conditions and the following     */
/*   disclaimer in the documentation and/or other materials provided */
/*   with the distribution.                                          */
/* - Neither the name of the HTS working group nor the names of its  */
/*   contributors may be used to endorse or promote products derived */
/*   from this software without specific prior written permission.   */
/*                                                                   */
/* THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND            */
/* CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,       */
/* INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF          */
/* MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE          */
/* DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS */
/* BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,          */
/* EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED   */
/* TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,     */
/* DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON */
/* ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,   */
/* OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY    */
/* OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE           */
/* POSSIBILITY OF SUCH DAMAGE.                                       */
/* ----------------------------------------------------------------- */
```

### 4.2 Open JTalk

```text
/* ----------------------------------------------------------------- */
/*           The Japanese TTS System "Open JTalk"                    */
/*           developed by HTS Working Group                          */
/*           http://open-jtalk.sourceforge.net/                      */
/* ----------------------------------------------------------------- */
/*                                                                   */
/*  Copyright (c) 2008-2016  Nagoya Institute of Technology          */
/*                           Department of Computer Science          */
/*                                                                   */
/* All rights reserved.                                              */
/*                                                                   */
/* Redistribution and use in source and binary forms, with or        */
/* without modification, are permitted provided that the following   */
/* conditions are met:                                               */
/*                                                                   */
/* - Redistributions of source code must retain the above copyright  */
/*   notice, this list of conditions and the following disclaimer.   */
/* - Redistributions in binary form must reproduce the above         */
/*   copyright notice, this list of conditions and the following     */
/*   disclaimer in the documentation and/or other materials provided */
/*   with the distribution.                                          */
/* - Neither the name of the HTS working group nor the names of its  */
/*   contributors may be used to endorse or promote products derived */
/*   from this software without specific prior written permission.   */
/*                                                                   */
/* THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND            */
/* CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,       */
/* INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF          */
/* MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE          */
/* DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS */
/* BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,          */
/* EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED   */
/* TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,     */
/* DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON */
/* ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,   */
/* OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY    */
/* OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE           */
/* POSSIBILITY OF SUCH DAMAGE.                                       */
/* ----------------------------------------------------------------- */
```

### 4.3 MeCab (file `mecab/COPYING` as shipped inside Open JTalk — the BSD licence)

```text
Copyright (c) 2001-2008, Taku Kudo
Copyright (c) 2004-2008, Nippon Telegraph and Telephone Corporation
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are
permitted provided that the following conditions are met:

 * Redistributions of source code must retain the above
   copyright notice, this list of conditions and the
   following disclaimer.

 * Redistributions in binary form must reproduce the above
   copyright notice, this list of conditions and the
   following disclaimer in the documentation and/or other
   materials provided with the distribution.

 * Neither the name of the Nippon Telegraph and Telegraph Corporation
   nor the names of its contributors may be used to endorse or
   promote products derived from this software without specific
   prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED
WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A
PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF
ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

/* ----------------------------------------------------------------- */
/*           The Japanese TTS System "Open JTalk"                    */
/*           developed by HTS Working Group                          */
/*           http://open-jtalk.sourceforge.net/                      */
/* ----------------------------------------------------------------- */
/*                                                                   */
/*  Copyright (c) 2008-2016  Nagoya Institute of Technology          */
/*                           Department of Computer Science          */
/*                                                                   */
/* All rights reserved.                                              */
/*                                                                   */
/* Redistribution and use in source and binary forms, with or        */
/* without modification, are permitted provided that the following   */
/* conditions are met:                                               */
/*                                                                   */
/* - Redistributions of source code must retain the above copyright  */
/*   notice, this list of conditions and the following disclaimer.   */
/* - Redistributions in binary form must reproduce the above         */
/*   copyright notice, this list of conditions and the following     */
/*   disclaimer in the documentation and/or other materials provided */
/*   with the distribution.                                          */
/* - Neither the name of the HTS working group nor the names of its  */
/*   contributors may be used to endorse or promote products derived */
/*   from this software without specific prior written permission.   */
/*                                                                   */
/* THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND            */
/* CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,       */
/* INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF          */
/* MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE          */
/* DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS */
/* BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,          */
/* EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED   */
/* TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,     */
/* DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON */
/* ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,   */
/* OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY    */
/* OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE           */
/* POSSIBILITY OF SUCH DAMAGE.                                       */
/* ----------------------------------------------------------------- */
```

### 4.4 pyopenjtalk / pyopenjtalk-plus

```text
The pyopenjtalk package is licensed under the MIT "Expat" License:

> Copyright (c) 2018: Ryuichi Yamamoto.
>
> Permission is hereby granted, free of charge, to any person obtaining
> a copy of this software and associated documentation files (the
> "Software"), to deal in the Software without restriction, including
> without limitation the rights to use, copy, modify, merge, publish,
> distribute, sublicense, and/or sell copies of the Software, and to
> permit persons to whom the Software is furnished to do so, subject to
> the following conditions:
>
> The above copyright notice and this permission notice shall be
> included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
> EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
> MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
> IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
> CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
> TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
> SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
/bAmFru).
```

### 4.5 CMU Pronouncing Dictionary

```text
Copyright (C) 1993-2015 Carnegie Mellon University. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
   The contents of this file are deemed to be source code.

2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in
   the documentation and/or other materials provided with the
   distribution.

This work was supported in part by funding from the Defense Advanced
Research Projects Agency, the Office of Naval Research and the National
Science Foundation of the United States of America, and by member
companies of the Carnegie Mellon Sphinx Speech Consortium. We acknowledge
the contributions of many volunteers to the expansion and improvement of
this dictionary.

THIS SOFTWARE IS PROVIDED BY CARNEGIE MELLON UNIVERSITY ``AS IS'' AND
ANY EXPRESSED OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL CARNEGIE MELLON UNIVERSITY
NOR ITS EMPLOYEES BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### 4.6 g2p-en (homograph table) — Apache License 2.0

`en/homographs.json` is `g2p_en/homographs.en` from g2p-en 2.1.0 (© Kyubyong Park), converted line by line to JSON (word → [pronunciation
if the part of speech matches, pronunciation otherwise, part-of-speech prefix]). The file's own header credits
http://www.minpairs.talktalk.net/graph.html as the origin of the list.

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "{}"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright {yyyy} {name of copyright owner}

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### 4.7 pypinyin, pinyin-data, phrase-pinyin-data (MIT)

The two dictionaries are the pypinyin data files as shipped in the piper-plus repository, with tone marks rewritten as tone numbers.

```text
The MIT License (MIT)

Copyright (c) 2016 mozillazg, 闲耘 <hotoo.cn@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

```text
The MIT License (MIT)

Copyright (c) 2016 mozillazg

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

```text
MIT License

Copyright (c) 2017 mozillazg

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 4.8 ONNX Runtime

```text
MIT License

Copyright (c) Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 4.9 Piper Plus

```text
MIT License

Copyright (c) 2022 Michael Hansen
Copyright (c) 2025 ayutaz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 5. Not confirmed — check before shipping

- **つくよみちゃん terms in practice.** Whether a credit inside a settings / about screen counts as "conspicuous, sufficient font size"
  is a judgement call; the page prefers an e-mail agreement before release. Publishing the model file in a public model repository is
  itself "making the voice available to third parties", so the same text belongs next to the download, and item 5 above (pass the
  terms on) applies if the app's source or the model is redistributable. A paid distribution channel needs the text on the store page.
- **MOE-Speech** (Japanese part of the base model's training data): the base model card states no licence for it. I did not look up
  its terms. The base model as a whole is published as CC-BY-4.0 by its author; whether that is compatible with MOE-Speech's own
  terms is unverified.
- **ayousanz's fine-tuned model**: the model card names only the corpus terms. No separate condition by the fine-tuner is stated; the
  attribution line in §3 is a courtesy plus the CC-BY duty of the base model.
- **Dictionary provenance**: the pyopenjtalk-plus README says its dictionary also takes in "neologd-derived patches" and UniDic-CSJ
  additions. The shipped `COPYING` covers NAIST, UniDic and Open JTalk; mecab-ipadic-NEologd (Apache-2.0) is not mentioned there.
- **CMUdict copy**: `cmudict_data.json` comes from the piper-plus repository, which describes it as CMUdict-derived; the repository
  carries no separate licence file for it. The licence text in §4.5 is the one from the cmusphinx/cmudict repository.
- **MeCab** is tri-licensed (GPL / LGPL / BSD); the BSD text is what Open JTalk ships and what is reproduced here.
- **Sudachi, NLTK data, g2p-en's neural model** were used only on the reference side during development; nothing of them ships.
