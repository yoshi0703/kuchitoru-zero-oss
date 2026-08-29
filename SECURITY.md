# Security policy / セキュリティポリシー

## Reporting / 報告方法

認証回避、店舗間のデータ参照、秘密情報の漏えい、外部投稿の承認回避などは、公開Issueへ書かないでください。GitHubのPrivate vulnerability reportingから報告するか、`info@kuchitoru.com` へ件名「クチトルZero Community セキュリティ報告」で連絡してください。実顧客データや本物のAPIキーは添付しないでください。

Do not disclose authentication bypasses, cross-store access, secret leakage, or approval bypasses in public issues. Use GitHub Private vulnerability reporting or email `info@kuchitoru.com` with the subject “Kuchitoru Zero Community security report.” Do not include real customer data or live API keys.

受領から3営業日以内に一次返信し、再現確認後に影響と対応予定を共有します。修正公開までは詳細の公開を控えてください。

We aim to acknowledge reports within three business days and will share impact and remediation timing after reproduction. Please withhold public details until a fix is available.

## Supported versions / 対象バージョン

最新のメジャーReleaseだけをセキュリティ修正の対象とします。自己ホスト運用者は新しいReleaseへ更新してください。

Only the latest major release receives security fixes. Self-hosted operators are responsible for upgrading.

## Security boundaries / セキュリティ境界

- 店舗の外部API認証情報は `AI_CREDENTIALS_MASTER_KEY_V1` などのversioned master keyで暗号化し、秘密値を取得APIから返しません。
- Provider endpointはコード内の許可先へ固定します。
- 外部AIへ送る前に個人情報をマスクし、入力と応答の上限、タイムアウトを適用します。
- 書き込み系の外部操作は接続済みの店舗に限り、操作時の明示承認を要求します。
- service role keyとマスターキーはサーバー側だけに置きます。
- CIと自動テストは実在する外部APIへ接続しません。

- Store credentials are encrypted with a versioned master key such as `AI_CREDENTIALS_MASTER_KEY_V1` and are never returned by read APIs.
- Provider endpoints are fixed to an allow-list in code.
- Personal information is masked before AI requests, with request/response limits and timeouts.
- External writes require a configured store connection and explicit approval at execution time.
- Service role and master keys remain server-side.
- CI and automated tests do not call live third-party APIs.
