# bootstrap

Creates what the pipeline needs before it can run: the APIs for IAM, the
Terraform state bucket, the deployer service account, and the Workload Identity
Federation pool and provider that let GitHub Actions impersonate it without a
key file.

**Manual only.** No workflow applies or plans this stack, and it has no remote
backend, so CI does not pick it up. The pipeline cannot create the identity it
logs in with, and it must not be able to change its own permissions.

## Apply (once per project)

```bash
gcloud auth application-default login      # an owner of the project
cd infra/bootstrap
cp default.tfvars myenv.tfvars             # set project_id, github_repository, state_bucket_name
terraform init
terraform apply -var-file=myenv.tfvars
terraform output -raw github_variable_commands | sh   # sets WIF_PROVIDER and DEPLOYER_SA
```

Then put `state_bucket` in the `bucket` line of the other stacks'
`backends/<env>.hcl` (`scripts/create_tfbackends.py` writes them).

State is a local `terraform.tfstate` here (gitignored). Keep it: it is the only
record needed to destroy the stack.

## Project that already has some of this

`apply` fails with `409 ... already exists` when the bucket, deployer or WIF pool
was created by hand. Adopt them first, then apply (it updates them in place):

```bash
terraform init
python3 import_existing.py myenv.tfvars
terraform plan -var-file=myenv.tfvars     # review the in-place changes
terraform apply -var-file=myenv.tfvars
```

A pool that `gcloud iam workload-identity-pools describe <pool> --location=global`
reports as `DELETED` cannot be imported: undelete it with
`gcloud iam workload-identity-pools undelete <pool> --location=global`, or pick a new `pool_id`.

## What it grants

GitHub identities whose `repository` claim equals `github_repository` (any
branch, tag or environment) can impersonate `terraform-deployer`. The deployer
holds the project roles listed in `main.tf` (`deployer_roles`), enough for the
network, GKE, runners and functions stacks. It is broad on purpose: it manages
IAM bindings. Trim the list if you deploy fewer stacks.

## Destroy

Last, after functions, runners, gke and foundation:

```bash
terraform destroy -var-file=myenv.tfvars
```

- Run it locally: the deployer being destroyed cannot run its own destroy.
- `state_bucket_force_destroy` defaults to `true`, so the bucket and the state
  inside it are deleted. Set it to `false` to keep them (apply first, then destroy).
- Google keeps a deleted pool and provider for 30 days and reserves their ids.
  To recreate right away, use new `pool_id` and `provider_id` values, or
  undelete the old ones.
