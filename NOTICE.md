# Notices

Copyright © 2026 Ranchu Japan合同会社.

クチトルZero Communityのソースコードは、特記のない限りGNU Affero General Public License version 3 or laterで提供されます。

The source code of Kuchitoru Zero Community is provided under the GNU Affero General Public License version 3 or later unless a file states otherwise.

## Brand assets

`src/assets/brand/` と `public/icons/` にあるクチトルZeroの名称、ロゴ、アイコンはRanchu Japan合同会社が権利を管理します。これらはAGPLの対象外です。利用条件は [TRADEMARKS.md](TRADEMARKS.md) を確認してください。

The Kuchitoru Zero names, logos, and icons under `src/assets/brand/` and `public/icons/` are controlled by Ranchu Japan LLC and are excluded from the AGPL grant. See [TRADEMARKS.md](TRADEMARKS.md).

再配布条件を確認できないShigureni素材は、このリポジトリとReleaseイメージに含みません。

Shigureni assets without confirmed redistribution terms are not included in this repository or release images.

## Third-party components

JavaScript依存関係のライセンスは `pnpm licenses list --prod` で確認できます。リリースCIは許可していないライセンスが追加された場合に失敗します。Webフォント `gen-interface-jp` はSIL Open Font License 1.1です。

JavaScript dependency licenses can be inspected with `pnpm licenses list --prod`. Release CI fails when a license outside the reviewed allow-list appears. The `gen-interface-jp` web font is licensed under the SIL Open Font License 1.1.

Docker導入スクリプトは、Supabase公式self-hosted bundle `self-hosted/v0.8.0` を取得します。このbundleはApache License 2.0で提供され、クチトルZero CommunityのAGPLコードとは別個のコンポーネントとして実行されます。

The Docker installer fetches the official Supabase self-hosted bundle at `self-hosted/v0.8.0`. That bundle is provided under Apache License 2.0 and runs as a separate component from the AGPL-licensed Kuchitoru Zero Community code.
