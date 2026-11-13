# Identité GitHub — adoption du WIF existant

Chaque projet possède déjà github/providers/github-oidc et le compte
terraform-deployer. imports.tf prépare leur adoption, ainsi que les deux grants
existants : impersonation WIF et compute.networkAdmin. Un nouveau grant de state
conditionnel et son rôle minimal sont préparés ; le grant bucket-wide existant n’est pas adopté car
il est trop large. Aucun second pool, clé JSON ou déployeur
concurrent n’est créé. Le pool système GKE *.svc.id.goog n’est pas géré ici.

Le provider conserve l’issuer GitHub et impose simultanément : dépôt exact,
repository_id=1429469761, repository_owner_id=114570075, environment dev/prod,
subject d’environnement exact, ref autorisée et workflow_ref du seul workflow
terraform-deploy.yml. Seul workflow_dispatch est autorisé actuellement.
trusted_refs contient main par défaut, sans wildcard. Les formats de subject
historique et immuable avec IDs sont acceptés ; les IDs numériques sont contrôlés
dans les deux cas. Les deux projets/pools et comptes restent distincts : DEV
ne peut satisfaire la condition d’environnement PROD.

L’ancien principalSet par nom de dépôt est conservé pour éviter un remplacement
de binding. Sa sécurité dépend des restrictions du seul provider GitHub de ce
pool : ne pas y ajouter un provider moins strict. Les audiences non configurées
conservent la vérification GCP du nom canonique du provider, sans audience globale.
Voir [GCP](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)
et [les claims GitHub](https://docs.github.com/en/actions/reference/security/oidc).

## Permissions et séparation administrative

- workloadIdentityUser est limité au service account existant ; aucune clé.
- compute.networkAdmin reprend le rôle de déploiement foundation déjà accordé.
  Aucun Owner/Editor, administrateur IAM, Secret Accessor ou rôle applicatif ajouté.
- Le rôle personnalisé terraformFoundationState, absent des deux projets au
  contrôle, contient uniquement storage.objects.get/create/update/delete/list,
  sans administration IAM, restauration ou rétention. Son grant a une condition : listing du bucket et
  lecture/écriture des seuls objets foundation/<env>/, verrous inclus. Le listing
  peut révéler les noms des autres objets, pas autoriser leur lecture/écriture.
  **Le grant inconditionnel historique couvre aussi access/identity/secrets et constitue un
  blocage de sécurité avant mise en service de ces states.** Il faut préparer
  le retrait du grant large sous approbation explicite, avec une transition
  coordonnée vers le grant conditionnel préparé. Ajouter
  seulement un grant conditionnel ne réduirait pas le droit cumulatif existant.
  Aucune révocation ni adoption de ce grant historique dangereux n’est automatisée.

Ce grant n’est pas le seul accès aux states : les grants GCS legacy des
Owner/Editor et les rôles de plusieurs comptes techniques s’y ajoutent.
Les deux buckets ont uniform bucket-level access activé ; leurs conditions
IAM sont utilisables, mais ne restreignent pas les autres grants cumulés.
Voir [l’audit des accès et la transition proposée](../C03.md#accès-effectifs-aux-states).

L’amorçage et la gestion des stacks de sécurité doivent utiliser une identité
humaine administrative autorisée, distincte du déployeur ordinaire. Droits à
scoper : gestion du pool, du compte, de ses bindings, des grants de projet/bucket
du rôle personnalisé et accès au state ; ne pas donner ces rôles au compte fédéré pour s’auto-administrer.
Les rôles Owner humains actuels restent hors du périmètre de révocation.

## Adoption et état des plans

Utiliser identity/dev ou identity/prod dans le bucket correspondant, avec les
tfvars assortis. Ne pas importer si un autre state devient propriétaire.
Les imports utilisent les IDs observés et le numéro canonique de projet pour
les ressources WIF ; ce n’est pas un changement de projet.

Les premiers plans cloud ont été exécutés dans des copies privées à backend
local, sans créer de state GCS. Ils ont échoué car l’import normalisait project
en numéro alors que le code utilisait son ID textuel : un remplacement du pool
était proposé et prevent_destroy l’a refusé. Le code a été corrigé pour employer
le numéro, puis les plans cloud suspendus conformément à la consigne de sécurité.
La mission suivante a autorisé leur reprise : le 13 novembre 2026, les deux
plans corrigés réussissent : **5 imports, 2 créations, 1 mise à jour, 0 destruction
ou remplacement** par projet. Pool, compte et bindings existants restent inchangés.
Seuls la condition et le mapping OIDC du provider sont mis à jour ; le rôle GCS
minimal et son grant conditionnel sont nouveaux. Aucun ignore_changes ajouté.

Les préfixes GCS identity/dev et identity/prod ont été vérifiés absents, dans
les buckets des projets attendus. Le backend GCS de Terraform 1.16.6 écrit un
state vide lorsqu’il n’existe pas : pour respecter l’interdiction de toute
écriture GCS, les plans interrogent GCP depuis des copies privées à backend
local, avec les mêmes tfvars, providers verrouillés et imports. Cela valide
les actions cloud, pas l’initialisation, l’écriture ou le verrouillage GCS.
Aucun import effectif, state géré local/distant ou apply réalisé ; ces plans
de revue ne doivent jamais servir à un apply. Refaire un plan avec le backend
canonique uniquement dans une future opération approuvée.

WIF_PROVIDER et DEPLOYER_SA sont exposés par outputs, sans modifier GitHub.
Les variables d’environnement GitHub doivent être vérifiées ultérieurement ;
les workflows et protections GitHub n’ont pas été changés ni déclenchés.
Les branches feature, PR et anciens déploiements sur tags ne satisfont pas la
politique proposée. L’autorisation d’autres workflows/refs/events et les
reviewers PROD relèvent d’une future mission CI/CD, après revue de sécurité.

Attention : origin/main à af889d6 contient encore le workflow historique,
avec apply, déclenchements sur tags et checkout d’un inputs.ref arbitraire.
Les claims ref/workflow_ref décrivent le workflow, pas nécessairement le code
checkouté. Le durcissement proposé rejettera les tags et les branches feature,
mais ne contrôle pas ce paramètre de checkout. La promotion et la revue du
workflow manuel de cette branche doivent précéder toute mise en service WIF.
Les valeurs GitHub et protections d’environnement n’ont pas pu être confirmées
(CLI non authentifiée) ; aucun token OIDC réel n’a été demandé ni workflow lancé.
