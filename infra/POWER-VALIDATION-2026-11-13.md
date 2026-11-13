> Archive de la premi?re version, remplac?e par les deux scripts simplifi?s.
> Le module infra_power.py et ses tests ont ?t? supprim?s ? la demande de l?utilisateur.
> Les contr?les, confirmations et blocages d?crits ci-dessous sont historiques ;
> voir [le guide actuel](../INFRA-POWER.md).

# Préparation ON/OFF — 13 novembre 2026

Branche `feature/c02-final-validation` conservée ; les changements préexistants
sont préservés. Aucun apply, destroy, import, migration de backend, activation
d'API ou modification de ressource GCP/Kubernetes n'a été exécuté pendant cette
préparation. Les seules écritures distantes temporaires sont les verrous normaux
des plans Terraform ; les données de cache, kubeconfig et plans sont privées.

Les scripts racine `deploy.py` et `destroy.py` partagent `infra_power.py`.
Ils proposent le menu demandé, `--env dev|prod|both` et `--plan-only`. Le parcours
réel exige une confirmation de chaque plan, plus récupération du credential ARC
et gel des écrivains avant OFF. Les noms, projets, zones, namespaces, backends,
workspaces, ressources et actions sont contrôlés. Bootstrap est exclu ; foundation
utilise seulement enable_nat, sans destroy. Les appels cloud hors Terraform sont
des lectures et la création du kubeconfig local. Aucun secret n'est lu ou copié.

Cloud NAT passe à une instance optionnelle via count et un bloc moved. Le défaut
true conserve le comportement actuel. ON n'autorise que les créations prévues ou
ce déplacement ; OFF seulement les suppressions GKE/ARC/NAT. Aucun changement
de VPC, subnet ou Router n'est accepté. La déprotection GKE n'autorise que le
champ deletion_protection puis demande un nouveau plan destroy. Les remplacements,
imports, suppressions de state et modifications inattendues sont refusés.

| Contrôle | DEV | PROD |
| --- | --- | --- |
| Init/validate foundation, gke, runners | Réussis | Réussis |
| Foundation ON | 0 création/modification/suppression ; NAT déplacé vers nat[0] | Identique |
| Foundation OFF | Uniquement suppression NAT | Uniquement suppression NAT |
| GKE ON | Aucun changement | Chaîne bloquée par inventaire GKE/API désactivée |
| GKE OFF | 4 suppressions prévues : cluster, pool, SA et liaison IAM | Pas de suppression exécutée ; state vide, absence réelle non certifiée |
| ARC ON | Aucun changement | Inventaire Kubernetes non accessible |
| ARC OFF | 2 suppressions prévues : scale set puis contrôleur selon depends_on | Pas de suppression exécutée ; state vide |
| Bootstrap | Plan réel exit 0, aucun changement | Plan réel exit 0, aucun changement |
| deploy.py / destroy.py --plan-only | Les deux réussissent | Arrêt sûr avant toute activation/suppression |

Les plans ON foundation retournent detailed-exitcode 2 à cause du moved, malgré
zéro action physique. Aucun déplacement n'a été écrit dans les states : cela
nécessitera l'application future du plan validé. DEV est actuellement déprotégeable
(deletion_protection=false) ; le chemin protégé true→false est vérifié par les
tests, sans application de déprotection. Un plan-only de suppression d'un cluster
protégé reste conditionnel à cette étape et à un nouveau plan.

Les vingt et un tests unitaires couvrent les ressources protégées, les identités, les
imports/remplacements, les plans incomplets, le moved, l'ordre ON/OFF, l'absence
d'apply en plan-only, les confirmations, les deux environnements, le cas déjà OFF,
les erreurs 403 et le gel après un échec, y compris après déprotection. Un test
vérifie qu'une invocation refusée par le verrou ne supprime pas les plans du
processus propriétaire. Les applications sont simulées dans ces tests.
Les trente tests existants du contrôleur foundation réussissent également ;
ils ont été relancés hors sandbox après un refus d'accès aux dossiers temporaires
Windows. Aucun test applicatif n'est nécessaire pour ces changements d'infrastructure.
`terraform fmt -check -recursive infra` et `git diff --check` réussissent.
Les workflows Terraform sont parsés en YAML et vérifiés manuels uniquement,
sans commande apply/destroy. Aucun actionlint disponible dans ce terminal.

Les workflows locaux retirent l'apply sur tag et l'ancien destroy foundation.
Ils n'ont pas été publiés ; les anciennes versions distantes et les autres
postes opérateurs restent à neutraliser avant OFF. Aucune protection GitHub
distante n'a été modifiée.

Blocage principal : le Secret ARC github-pat-arc existe dans DEV mais sa source
hors cluster n'existe pas, selon confirmation utilisateur. Les scripts ne
prétendent pas restaurer ce credential. Sans restauration Terraform du namespace
et du Secret, ON refuse un cluster absent avant d'engager des coûts ; un cycle
complet OFF→ON n'est donc pas encore opérationnel. Aucun nouveau PAT ni stockage
de credential en Git/state n'a été introduit. PROD reste aussi bloqué par son API
GKE et le budget précédent de 20 USD/mois pour un cluster permanent.

OFF conserve réseaux et buckets, mais n'intervient pas sur C05–C08, d'autres
disques, IP, load balancers ou workloads hors des states concernés. Stockage GCS,
versions et logs peuvent rester facturables. Une séquence échouée ne déclenche
aucun rollback automatique et peut laisser des ressources payantes actives.
Le [guide opérateur](../INFRA-POWER.md) décrit les commandes et limites.

L'inventaire en lecture seule inclut les deux projets et dix states courants,
dont l'archive historique foundation/prd, jamais utilisée comme backend actif.
GitNexus impact a été exécuté avant édition : Terraform et les nouveaux scripts
retournent UNKNOWN, sans graphe d'appel résolu ; les recherches complémentaires
et plans réels servent donc de contrôle. Les rapports détaillés de plan et de
graphe sont conservés dans .gitnexus ignoré ; aucun state brut n'est versionné.

Le relevé final confirme les dix states identiques avant/après (générations,
lineages, serials, tailles et checksums), les deux inventaires GCP identiques et
aucun verrou résiduel. L'archive historique est elle aussi inchangée.

Après actualisation de GitNexus, detect_changes scope all couvre 50 fichiers,
144 symboles et 11 processus ; compare à origin/main couvre 80 fichiers et
171 symboles. Les deux résultats sont **HIGH**, partial=false et truncated=false.
Les onze processus concernent les nouveaux chemins main/switch_environment,
préflight ARC, init/backend, state/identités, plan/validation et apply/exécution.
Ce résultat n'est pas traité comme un feu vert pour une suppression réelle.
Les nouveaux fichiers ont été inclus via un index Git temporaire ; le checksum
de l'index réel reste identique. Aucun commit, push, merge ou changement de branche.
