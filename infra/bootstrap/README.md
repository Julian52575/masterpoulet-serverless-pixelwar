# Existing Terraform state buckets

This root adopts the existing GCS buckets without creating new ones. It manages
one bucket per state and does not manage their objects, IAM bindings, foundation,
GKE or runners. Do not declare these buckets in another Terraform root.

| Environment | Project | Existing bucket | Backend prefix |
| --- | --- | --- | --- |
| DEV | masterpoulet-dev | masterpoulet_bucket | bootstrap/dev |
| PROD | masterpoulet-prod | masterpoulet_prod_bucket | bootstrap/prod |

Both buckets are regional in `EUROPE-WEST1`, including the PROD bucket. Their
existing versioning, Uniform Bucket-Level Access, enforced Public Access
Prevention, seven-day soft delete, encryption restrictions and noncurrent-version
lifecycle rules are declared as observed. No locked retention policy is added.
Provider attribution labels are disabled to avoid changing bucket metadata.

`prevent_destroy` rejects a destroy while the resource declaration remains;
`force_destroy = false` also prevents Terraform from emptying these buckets.
Keep the resource and its protection in version control. These controls do not
protect against deleting the configuration or deleting buckets outside Terraform.

## Plan and adopt

Use ADC credentials without putting them in files tracked by Git. From this
directory, pair `backends/dev.hcl` with `dev.tfvars`, or `backends/prod.hcl` with
`prod.tfvars`. Use a separate local `TF_DATA_DIR` for each environment and the
`default` workspace. The selected backend must have the bucket and prefix above.

```sh
terraform fmt -check -recursive
terraform init -backend-config=backends/dev.hcl -input=false -lockfile=readonly
terraform workspace show
terraform validate
terraform plan -var-file=dev.tfvars -input=false -lock-timeout=60s -out=dev.tfplan
```

Before the first import, search the accessible states and configurations for an
existing owner and record the generation/checksum of all pre-existing state
objects. The first plan must show exactly one import and zero create, update,
delete or replacement actions. Stop on any other action. Apply only that reviewed
saved plan, then run a new plan and compare the bucket metadata and old state
object generations/checksums with the initial inventory:

```sh
terraform apply -input=false dev.tfplan
terraform plan -var-file=dev.tfvars -input=false -lock-timeout=60s -detailed-exitcode
```

Repeat for PROD with its own local data directory, backend and tfvars. The import
blocks are retained as adoption history; after import they perform no operation.
No state migration, object deletion or IAM update is part of this procedure.

## Backend lifecycle

Each bootstrap state lives under its own prefix in the existing bucket it
manages. The bucket must therefore already exist and be accessible before init.
This is adoption of existing infrastructure, not a procedure for recreating a
deleted state bucket. Keep these buckets independent of application cleanup and
never include this root in an apply/destroy/recreate demonstration.

The historical PROD foundation state at `foundation/prd` and the currently
configured prefix `foundation/prod` are separate objects. Adopting the bucket
does not reconcile or migrate either state. See the [C02 validation report](../foundation/VALIDATION-2026-11-11.md).

References: [Terraform imports](https://developer.hashicorp.com/terraform/language/import),
[lifecycle protection](https://developer.hashicorp.com/terraform/language/meta-arguments/lifecycle),
[Google bucket resource](https://registry.terraform.io/providers/hashicorp/google/7.46.1/docs/resources/storage_bucket).
