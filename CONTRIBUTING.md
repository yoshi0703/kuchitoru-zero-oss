# Contributing / コントリビューション

クチトルZero Communityへのコントリビューションを歓迎します。小さく、目的が明確で、読みやすい変更を優先します。

We welcome contributions to Kuchitoru Zero Community. Prefer small, focused, readable changes.

## Development

1. Node.js 24とpnpm 10を用意します。
2. `pnpm install --frozen-lockfile` を実行します。
3. IssueまたはPRで、変更の目的と確認方法を簡潔に説明します。
4. `pnpm check` と変更箇所に関係するEdge、DB、RLS、E2Eテストを実行します。

Do not add real credentials, production identifiers, customer data, or provider responses. Do not add billing, credits, a platform-operated AI gateway, or automatic posting to the Community edition.

## DCO 1.1

このプロジェクトはCLAを使いません。各コミットに [Developer Certificate of Origin 1.1](https://developercertificate.org/) への同意を示す `Signed-off-by` 行が必要です。

This project does not use a CLA. Every commit must include a `Signed-off-by` line confirming the Developer Certificate of Origin 1.1.

```bash
git commit -s -m "feat: describe the change"
```

署名行は、コミット作成者がその変更を提出する権利を持つことを示します。著作権譲渡や、AGPL以外への再ライセンス許諾ではありません。

The sign-off confirms your right to submit the change. It is not a copyright assignment and does not grant permission to relicense your contribution outside the AGPL.

## Hosted edition boundary

Ranchu Japan合同会社が作成した共通修正はCommunity版とHosted版の間で同期することがあります。外部コントリビューターの変更は、そのコントリビューターから別途明示的な許諾を得ない限り、非公開Hosted版へコピーしません。

Changes authored by Ranchu Japan may be synchronized between Community and Hosted. Contributions from third parties are not copied into the private Hosted edition without separate, explicit permission from the contributor.

## Pull requests

- PRはReady for reviewで提出してください。
- 1つのPRでは1つの目的を扱ってください。
- DB変更は空DBから適用できる前方Migrationにしてください。
- 店舗Aから店舗Bを参照できないこと、秘密値がレスポンスやログへ出ないことを確認してください。
- UI変更は日本語と英語、主要なスマートフォン幅を確認してください。

- Open pull requests as ready for review.
- Keep one purpose per pull request.
- Database changes must be forward migrations that apply to an empty database.
- Verify tenant isolation and that secrets never appear in responses or logs.
- Check both Japanese and English UI at a representative mobile width.

By participating, you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
