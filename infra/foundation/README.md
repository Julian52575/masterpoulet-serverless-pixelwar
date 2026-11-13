# Foundation: development and production networks

Use `prod` consistently for the production environment, variable file, backend
file and canonical remote prefix. Before using PROD, check the status and safety
conditions in the [PROD migration report](MIGRATION-PROD-2026-11-11.md). A prepared
or blocked migration is not a completed migration; do not apply a plan that
recreates an existing VPC or subnet.

This root manages the custom VPC, subnet, Cloud Router and Cloud NAT. It does not
manage buckets, IAM, APIs, GKE clusters or runners. Default networks remain
outside this state. State buckets are managed by the independent
[bootstrap root](../bootstrap/README.md).

Cloud NAT can be disabled with `enable_nat=false`; VPC, subnet and Router remain.
The default is true. A moved block preserves the existing NAT as
`google_compute_router_nat.nat[0]`. Use the root [ON/OFF scripts](../../INFRA-POWER.md)
to remove ARC and GKE first; never run foundation destroy to switch OFF.

| Setting | DEV | PROD |
| --- | --- | --- |
| Variables | `dev.tfvars` | `prod.tfvars` |
| Project | `masterpoulet-dev` | `masterpoulet-prod` |
| Subnet region | `europe-west1` | `europe-west3` |
| VPC | `masterpoulet-dev-vpc` | `masterpoulet-prod-vpc` |
| Subnet | `masterpoulet-dev-vpc-subnet` | `masterpoulet-prod-vpc-subnet` |
| Primary CIDR | `10.0.1.0/24` | `10.0.2.0/24` |
| Backend config | `backends/dev.hcl` | `backends/prod.hcl` |
| State bucket | `masterpoulet_bucket` | `masterpoulet_prod_bucket` |
| Canonical state prefix | `foundation/dev` | `foundation/prod` |
| Workspace | `default` | `default` |

Both state buckets are in `europe-west1`; bucket and subnet regions are separate
settings. Private Google Access is enabled on the subnet and does not replace
Cloud NAT. Router/NAT use the environment's VPC and region. NAT covers the primary
and secondary ranges of the selected subnet.

## C04 dependency

GKE DEV already uses this network and its secondary ranges. The complete
foundation configuration in [PR #12](https://github.com/Julian52575/masterpoulet-serverless-pixelwar/pull/12)
at `1ae9c75` declares those ranges and was used for the reviewed migration plans.
The current branch includes the necessary C04 secondary-range definitions.
Do not apply an older configuration that removes ranges used by GKE. Align the
reviewed revision with C04 before any network deployment.

## Check a selected environment

Use ADC credentials outside Git. Use a separate local `TF_DATA_DIR` for each
environment so switching environment does not trigger an unintended state copy.
Pair the backend and tfvars from the same table column and require the default
workspace. Stop after any failed command or unexpected plan.

From this directory, for PROD after the migration has been confirmed complete:

```sh
terraform fmt -check -recursive
terraform init -backend-config=backends/prod.hcl -input=false -lockfile=readonly
terraform workspace show
terraform validate
terraform state list
terraform plan -var-file=prod.tfvars -input=false -lock-timeout=60s
```

Use `backends/dev.hcl` and `dev.tfvars` for DEV in its own local data directory.
Verify the selected backend's bucket/prefix before planning. Neither the active
gcloud project nor a new terminal selects Terraform's backend. Never migrate
states merely to switch environment.

On 13 November 2026, the reviewed PROD plan created the missing Router and NAT
and added Pods `10.32.0.0/21` and Services `10.32.8.0/24` to the existing subnet
in place. The VPC and primary range were preserved. The subsequent canonical
plan returned no changes. See the [deployment report](FINALISATION-PROD-2026-11-13.md)
for the remaining GKE and runners prerequisites. The earlier migration reports
remain historical records; no migration was repeated during this deployment.

## Inspection and outputs

`python3 scripts/check.py --env prod` compares config with GCP without running
Terraform or reading its state. See [scripts/README.md](scripts/README.md).
This cannot establish state ownership; use the matching backend and a real plan.

Outputs are `network_id`, `subnet_id` and the primary `subnet_cidr`. GKE reads the
network by name through data sources, not through `terraform_remote_state`.
Do not destroy the shared DEV or PROD foundation to test reproducibility; use
the independent [validation root](../validation/README.md).

The [23 October audit](AUDIT.md), [pre-migration C02 snapshot](VALIDATION-2026-11-11.md)
and its evidence are archives. Their earlier paths, observations and commands do
not override the canonical production configuration or the migration report.
