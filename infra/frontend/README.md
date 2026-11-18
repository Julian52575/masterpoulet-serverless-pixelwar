# Frontend hosting (Firebase Hosting)

The built SPA (`app/frontend/dist`) is served by Firebase Hosting on the project's default site
(`https://<project_id>.web.app`), with HTTPS and CDN included. Terraform only enables
`firebasehosting.googleapis.com`; the files are published by the `Terraform Deploy` workflow
(`firebase deploy --only hosting`) right after the `frontend` leg applies.

Config: `app/frontend/firebase.json` (SPA rewrite, `index.html` no-cache, `/assets/**` immutable).

## One-time setup

- Grant the deployer service account (`DEPLOYER_SA`) `roles/firebasehosting.admin`.
- Nothing else to set: the workflow reads `api_base_url`, `firebase_web_api_key` and `firebase_web_app_id` from the `serverless/functions` state. `APP_URL` is optional (custom domain).
- The first apply after the move from the old bucket + load balancer deletes those resources:
  run it once with `allow_destroy`.

## Manual deploy

```bash
cd app/frontend
F=../../infra/serverless/functions
VITE_API_BASE=$(terraform -chdir=$F output -raw api_base_url) \
VITE_FIREBASE_API_KEY=$(terraform -chdir=$F output -raw firebase_web_api_key) \
VITE_FIREBASE_APP_ID=$(terraform -chdir=$F output -raw firebase_web_app_id) \
VITE_FIREBASE_PROJECT_ID=<project> npm run build
npx firebase-tools deploy --only hosting --project <project>
```

Never set `VITE_BYPASS_DISCORD` in a deployed build.

## API routing

All `/api/*` traffic goes through API Gateway: the build sets `VITE_API_BASE` to the gateway URL
and the gateway allows CORS (`x-google-endpoints` + `OPTIONS` per path). Login is a plain
navigation to the gateway, so the OAuth state cookie stays on the gateway host.
