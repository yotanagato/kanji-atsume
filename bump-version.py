"""版を1つ進める。

index.html の APP_VERSION / version.json / sw.js のキャッシュ名を、
必ず同じ値に揃えて書き換える。ここがズレると、
起動時の版チェックが毎回「古い」と判断して読み直しを繰り返す。

    python bump-version.py            → 今日の日付で連番を1つ進める
    python bump-version.py 2026-10-01-1 → 値を指定する

push する前に実行すること。
"""
import io
import re
import sys
from datetime import date

INDEX = "index.html"
VERSION_JSON = "version.json"
SW = "sw.js"


def current():
    s = io.open(INDEX, encoding="utf-8").read()
    m = re.search(r'const APP_VERSION = "([^"]+)"', s)
    return m.group(1) if m else ""


def next_version():
    today = date.today().isoformat()
    cur = current()
    if cur.startswith(today + "-"):
        try:
            return "%s-%d" % (today, int(cur.rsplit("-", 1)[1]) + 1)
        except ValueError:
            pass
    return today + "-1"


def main():
    ver = sys.argv[1] if len(sys.argv) > 1 else next_version()

    s = io.open(INDEX, encoding="utf-8").read()
    s, n = re.subn(r'const APP_VERSION = "[^"]+"', 'const APP_VERSION = "%s"' % ver, s)
    if n != 1:
        raise SystemExit("index.html の APP_VERSION が見つかりません")
    io.open(INDEX, "w", encoding="utf-8", newline="\n").write(s)

    io.open(VERSION_JSON, "w", encoding="utf-8", newline="\n").write('{ "v": "%s" }\n' % ver)

    sw = io.open(SW, encoding="utf-8").read()
    sw, n = re.subn(r'const CACHE = "[^"]+"', 'const CACHE = "manabi-%s"' % ver, sw)
    if n != 1:
        raise SystemExit("sw.js の CACHE が見つかりません")
    io.open(SW, "w", encoding="utf-8", newline="\n").write(sw)

    print(ver)


if __name__ == "__main__":
    main()
