# Bootstrap — buckets Terraform existants

| Cible | Bucket | Backend |
| --- | --- | --- |
| DEV | masterpoulet_bucket | bootstrap/dev |
| PROD | masterpoulet_prod_bucket | bootstrap/prod |

Les deux buckets sont dans europe-west1. Chaque bucket a un seul propriétaire :
google_storage_bucket.terraform_state dans son state bootstrap respectif,
confirmé par lecture des states accessibles le 13 novembre 2026.

Conserver prevent_destroy, force_destroy=false, versioning, Public Access
Prevention, Uniform Bucket-Level Access, soft delete et les règles de rétention
des anciennes versions. Ces paramètres reprennent les buckets existants.
Les import blocks sont l’historique d’adoption, pas une invitation à relancer
un import. Ne pas déclarer ces buckets dans foundation ou un autre state.

Utiliser backends/dev.hcl avec dev.tfvars, ou les deux fichiers prod, dans un
TF_DATA_DIR dédié et le workspace default. Le bucket doit déjà exister avant
init puisque son propre state y réside. Aucun destroy de ce root pour une démo.
Les protections Terraform ne remplacent pas les droits IAM ni la sauvegarde.

Les commandes standard et prérequis sont dans le [guide commun](../README.md).
