# RINTO 森林情報クラウド・クローン MVP（GitHub + Firebase）

## セットアップ
1. Firebase プロジェクト作成 → Auth(Google)有効化 → Firestore/Storage有効化  
2. `frontend/.env` を `.env.example` からコピーして値を設定  
3. 依存インストール
   ```bash
   cd frontend && npm i
   cd ../functions && npm i
   cd ..
