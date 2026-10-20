# ゆけむりマップ

全国の温泉を地図で探せるスマホ向けWebアプリ（PWA）です。ホーム画面に追加すると、アプリのように全画面で起動します。

## できること

- 全国の温泉施設・源泉・公衆浴場を地図とリストで表示（OpenStreetMap のデータ）
- 温泉名・都道府県・地名で検索、種類で絞り込み
- 「現在地」で近い順に並べ替え
- 各温泉から Googleマップ、ルート検索、Web検索、公式サイトへ移動

## ファイル構成

| パス | 内容 |
| --- | --- |
| `index.html` | アプリ本体（地図・検索・リスト） |
| `manifest.webmanifest`, `icons/` | ホーム画面に追加するための設定とアイコン |
| `sw.js` | オフラインでも開けるようにするキャッシュ |
| `scripts/fetch-onsen.mjs` | OpenStreetMap から全国の温泉データを集めて `data/onsen.json` を作るスクリプト |
| `.github/workflows/update-data.yml` | 上のスクリプトを毎週自動で実行し、データを更新する |

`data/onsen.json` がまだない間は、アプリに組み込んだ代表的な温泉地191か所のサンプルを表示します。

## 公開の手順（GitHub Pages）

1. このフォルダを GitHub リポジトリに置く
2. リポジトリの Settings → Pages で「Deploy from a branch」、ブランチ `main` / フォルダ `/ (root)` を選ぶ
3. Actions タブで「温泉データを更新」を手動実行すると `data/onsen.json` ができ、全国のデータが表示される
4. 表示された URL をスマホで開き、共有メニューから「ホーム画面に追加」

## ローカルで試す

```sh
node scripts/fetch-onsen.mjs   # 全国データの取得（数分かかることがあります）
python3 -m http.server 8000    # http://localhost:8000 を開く
```

## データについて

施設データは © OpenStreetMap contributors（ODbL ライセンス）です。登録の抜けや、泉質・営業時間などの情報が少ない施設もあります。
