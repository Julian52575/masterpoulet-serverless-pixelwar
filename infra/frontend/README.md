# Frontend static hosting infrastructure

Terraform configuration for deploying the statically built Pixelwar frontend (`app/frontend/dist`).

## Architecture

```
Internet ──► External HTTP Load Balancer (Cloud CDN) ──► Cloud Storage Bucket (static assets)
```

- **`google_storage_bucket.frontend`**: Stores the static files produced by `npm run build` in `app/frontend`. Uniform bucket-level access and website configuration (`main_page_suffix = "index.html"`, `not_found_page = "index.html"` for SPA).
- **`google_storage_bucket_iam_member.public_read`**: Grants `roles/storage.objectViewer` to `allUsers`.
- **`google_compute_backend_bucket.frontend`**: Backend bucket with Cloud CDN enabled for asset caching.
- **`google_compute_url_map` & `google_compute_target_http_proxy` & `google_compute_global_forwarding_rule`**: Exposes a global HTTP load balancer endpoint.

## Files

- `main.tf`: Storage bucket, IAM, Cloud CDN backend bucket and global forwarding rule.
- `apis.tf`: Required APIs (`storage.googleapis.com`, `compute.googleapis.com`).
- `providers.tf`: Provider constraints (`hashicorp/google`).
- `backend.tf`: GCS remote state declaration.
- `backends/dev.hcl` and `backends/prod.hcl`: State bucket and prefix configurations.
- `dev.tfvars` and `prod.tfvars`: Environment-specific variable definitions.
- `variables.tf` and `outputs.tf`: Variable and output declarations.

## Deploying

```bash
cd infra/frontend
terraform init -backend-config=backends/dev.hcl
terraform plan -var-file=dev.tfvars
terraform apply -var-file=dev.tfvars
```

Once applied, sync the built frontend files to the bucket:

```bash
cd app/frontend && npm run build
gcloud storage rsync -r dist/ "gs://$(terraform -chdir=../../infra/frontend output -raw bucket_name)"
```
