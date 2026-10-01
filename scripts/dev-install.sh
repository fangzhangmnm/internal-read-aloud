#!/usr/bin/env bash
# dev-install —— 开发期把**还没发版**的本库装进某个宿主仓做验证（只许在宿主的分支上用，不进宿主 main）。
# created 2026-09-29 by Claude Fable 5.1
#
# 用法（在本库仓根）：bash scripts/dev-install.sh "../20260524 WeebPaint"
#
# 为什么需要它：开发期版本号一直是 0.0.0。直接把新打的 tgz 覆盖进宿主的 vendor-pkgs/ 再 npm install，
#   npm 会按宿主锁文件里**旧的校验值**命中缓存，装进去的还是旧包——测试全绿但测的是旧代码
#   （2026-09-29 当天真踩过）。本脚本：构建 → 打包 → 删掉宿主锁文件里这一个包的条目 → 重装 → 验货。
# 正式收货不走这里：发版后用 pull-package.sh（只认打过 tag 的已发版）。
set -euo pipefail
LIB_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$(cd "${1:?用法：bash scripts/dev-install.sh <宿主仓目录>}" && pwd)"
PKG="@internal/read-aloud"
die() { echo "[dev-install] ✗ $*" >&2; exit 1; }

[ -f "$APP_DIR/package.json" ] || die "$APP_DIR 里没有 package.json"
branch="$(git -C "$APP_DIR" branch --show-current)"
case "$branch" in main|prod|master) die "宿主现在在 $branch 分支。开发包只许装在宿主的工作分支上。" ;; esac

cd "$LIB_DIR"
bash scripts/build.sh >/dev/null
ver=$(node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).version")
tgz="internal-read-aloud-$ver.tgz"
rm -f "$tgz"; npm pack --silent >/dev/null
want="$(sha256sum "$tgz" | cut -d' ' -f1)"

mkdir -p "$APP_DIR/vendor-pkgs"
cp "$tgz" "$APP_DIR/vendor-pkgs/$tgz"
cd "$APP_DIR"
node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
  (p.dependencies ??= {})[process.argv[1]] = "file:./vendor-pkgs/" + process.argv[2];
  fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
  if (fs.existsSync("package-lock.json")) {
    const l = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
    if (l.packages) delete l.packages["node_modules/" + process.argv[1]];
    fs.writeFileSync("package-lock.json", JSON.stringify(l, null, 2) + "\n");
  }
' "$PKG" "$tgz"
rm -rf "node_modules/$PKG"
npm install --no-audit --no-fund >/dev/null

# 验货：装进去的每个 dist 文件都必须和刚构建的逐字节相同
while IFS= read -r -d '' f; do
  rel="${f#"$LIB_DIR/dist/"}"
  cmp -s "$f" "node_modules/$PKG/dist/$rel" || die "验货失败：node_modules/$PKG/dist/$rel 和刚构建的不一样（装到旧包了？）"
done < <(find "$LIB_DIR/dist" -type f -print0)
echo "[dev-install] ✓ $PKG@$ver 已装进 $APP_DIR（分支 $branch；tgz sha256 ${want:0:12}…；dist 逐字节对上）"
