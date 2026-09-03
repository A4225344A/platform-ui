# EngOps Control Plane UI

React + TypeScript + Vite frontend for the EngOps control plane lab.

## Local Development

Run the backend on the same machine first:

```bash
kubectl port-forward svc/engops-api 8000:8000
```

Then start the UI:

```bash
npm run dev
```

The Vite dev server proxies `/api/*` to `http://127.0.0.1:8000`, so application code always uses same-origin API paths.

## Routes

- `/`
- `/incidents/:id`
- `/settings/log-sink`

Unknown UI paths return to the overview page. Production hosting still needs SPA deep-link fallback in CloudFront or the same-container static server.

## Localization

The UI uses `i18next` and `react-i18next`.

- Translations live in `src/i18n.ts`.
- Components read strings with `useTranslation()`.
- The language switcher supports `EN`, `中`, and `Both`.
- `Both` mode renders English and Traditional Chinese together by reading both i18next resources.

## Write Mode

The UI is read-only by default. To test the private lab-only log sink proposal form:

```bash
VITE_ENABLE_WRITES=true npm run dev
```

Do not put `ENGOPS_API_TOKEN` or other machine tokens in the SPA bundle or browser storage.

## Deployment

The `Deploy EngOps UI` workflow builds the Vite app and deploys `dist/` to the
Task 11.5 S3 + CloudFront hosting stack.

Required repository variables (Settings → Secrets and variables → Actions →
Variables) — the workflow has no built-in defaults, so it fails fast if any
are missing:

- `AWS_REGION`
- `GHA_APP_DEPLOY_ROLE_ARN`
- `UI_BUCKET`
- `CLOUDFRONT_DISTRIBUTION_ID`

Pull requests run build and lint only. Pushes to `main` and manual workflow
runs deploy the artifact and create a CloudFront invalidation.
