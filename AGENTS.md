# Kuchitoru Zero Community Agent Rules

このリポジトリは、セルフホスト向けの独立したCommunity版です。非公開のHosted版、その本番DB、Cloudflare、認証情報には触れません。

## Edition boundaries

- AIは店舗ごとのBYOKのみです。クチトル側のAI中継、課金、クレジット、試用枠を追加しません。
- APIキーとOAuth secretはEdge Functionsだけが扱います。レスポンス、ログ、ブラウザbundleへ含めません。
- 外部投稿やプロフィール更新は初期状態で無効です。明示的な設定と担当者の承認なしに実行しません。
- Community版とHosted版が同一コード、同一機能であるとは案内しません。

## Implementation

- シンプルで見通しのよい実装を優先し、要求外の抽象化や互換層を増やしません。
- 変更範囲を狭く保ち、既存の差分を戻しません。
- DB変更は新規Migrationとして追加します。公開済みMigrationは編集しません。
- 変更後は、影響範囲に応じて型検査、対象テスト、境界検査を実行します。

## Contributions and releases

- コミットにはDCO 1.1の `Signed-off-by` を付けます。
- PRは原則Ready for reviewで作成します。
- 公開や本番環境への書き込みは、対象と結果を確認できる明示的な依頼がある場合だけ実行します。
- リリース前に `pnpm verify:community` と関連するCIが成功していることを確認します。
