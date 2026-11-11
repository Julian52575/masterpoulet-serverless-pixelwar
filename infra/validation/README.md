# Isolated C02 reproducibility check

This independent Terraform root manages exactly two temporary resources in
`masterpoulet-dev`: a custom VPC and one subnet in `europe-west1`. It never uses
the foundation network. It creates no VM, GKE cluster, NAT, public IP or bucket.
Do not add other resource types to this test.

Use a fresh `YYYYMMDD-HHMMSS-xxxx` run ID, where `xxxx` is four lowercase hex
characters. The VPC is `c02-validation-<run_id>` and the subnet adds `-subnet`.
Check that both names and the selected canonical IPv4 /28 are unused. The example
CIDR is illustrative; always compare it with the current subnet inventory.

## Separate backend and local data

Copy `backend.hcl.example` to `backend.hcl` and `run.tfvars.example` to `run.tfvars`.
Replace the run ID consistently. The state must be
`gs://masterpoulet_bucket/validation/c02/<run_id>/default.tfstate`, never any
foundation, GKE, runners or bootstrap prefix. Use a new local `TF_DATA_DIR` and
the default workspace. Keep generated inputs, saved plans and evidence outside Git.

From this directory:

```sh
terraform fmt -check -recursive
terraform init -backend-config=backend.hcl -input=false -lockfile=readonly
terraform workspace show
terraform validate
terraform plan -var-file=run.tfvars -input=false -lock-timeout=60s -out=create.tfplan
```

Before applying a saved plan, inspect `terraform show -json <plan>` locally.
For creation, the only managed actions must be `create` on
`google_compute_network.validation` and `google_compute_subnetwork.validation`.
Their project must be `masterpoulet-dev`, their names must match the fresh run ID,
and there must be no existing resource with either name. Reject all replacements,
changes to existing resources, other addresses and other projects.

## Two cycles and final cleanup

1. Apply the reviewed creation plan. Read the network and subnet from GCP and
   record their names, numeric IDs and settings. A new normal plan must exit 0.
2. Prepare a saved destroy plan in this root with the same backend and tfvars.
   Accept only deletes of those exact two addresses, names, IDs and project.
   Apply the saved plan and confirm both resources are absent using GCP reads.
3. Recreate the same names and configuration from the now-empty test state.
   Confirm presence and a new zero-change normal plan.
4. Repeat the narrowly checked destroy and confirm absence again. The remote
   test state is left as an empty evidence record; do not delete GCS objects.

```sh
terraform apply -input=false create.tfplan
terraform plan -var-file=run.tfvars -input=false -lock-timeout=60s -detailed-exitcode
terraform plan -destroy -var-file=run.tfvars -input=false -lock-timeout=60s -out=cleanup.tfplan
terraform apply -input=false cleanup.tfplan
```

These commands are restricted to this isolated root and its validated test
backend. Never run them against `infra/foundation`, `infra/gke`, `infra/runners`
or `infra/bootstrap`. If an operation partially fails, inspect the test state
and prepare a new cleanup plan containing only resources owned by that run.

The [11 November 2026 validation report](../foundation/VALIDATION-2026-11-11.md)
records the executed cycles and their GCP evidence. The test demonstrates
VPC/subnet reproducibility; it does not demonstrate GKE or ARC recreation.
