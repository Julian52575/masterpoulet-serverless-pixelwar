# Accès humains — state indépendant

Ce root ne gère que des google_project_iam_member additifs. Il conserve les
autres membres et rôles, sans IAM policy/binding autoritatif. prevent_destroy
protège les grants déclarés ; la suppression de leur code doit aussi être revue.
Les accès restent indépendants des cycles de destruction GKE/foundation/app.

Le [sujet Epitech, §1.3](https://drive.google.com/file/d/1W9oJrCWBW3CQpzdskcjJwv6HTqQYDC7O/view)
impose Editor pour jeremie@jjaouen.com sur les deux projets. Cette exception
explicite est déjà présente et son adoption est préparée dans imports.tf.
Le rôle billingAccountCudViewer existant n’est pas modifié.

L’utilisateur a confirmé les trois membres : JBottiglione88@gmail.com,
louislorrainm@gmail.com et somnarem@gmail.com. Les tfvars reprennent leurs
bindings Owner déjà présents dans chaque projet. Chaque binding a un import
explicite : si le grant n’existe pas, arrêter, ne pas attribuer Owner à un nouvel
utilisateur. Aucun binding Viewer/Editor redondant n’est ajouté à l’équipe.

Owner est un privilège historique excessif, conservé sur demande pour éviter
une révocation ou une perte d’accès. L’adoption n’en fait pas une baseline
recommandée. Une réduction séparée devra inventorier les opérations réellement
nécessaires à chaque membre et les tester avec les rôles candidats : déploiement
foundation via le compte WIF dédié, lecture des ressources/logs pour les revues,
et droits d’amorçage IAM réservés aux opérateurs autorisés. Ne pas empiler Viewer
sur Owner ; approuver les rôles de remplacement et leur test avant de retirer
Owner. La protection prevent_destroy devra être levée explicitement pour cette
transition, jamais lors de la destruction des workloads.

Ce root ne gère aucun service account, rôle de déployeur ou secret. Les quatre
imports préparés par projet n’ont pas été appliqués ; aucune permission ne change.

Backends : access/dev dans masterpoulet_bucket, access/prod dans
masterpoulet_prod_bucket. environment détermine exclusivement masterpoulet-dev
ou masterpoulet-prod. Associer les fichiers backend/tfvars du même environnement.
Valider avec un TF_DATA_DIR distinct et init -backend=false ; ne pas initialiser
les nouveaux states GCS avant approbation. Voir [C03](../C03.md) pour les résultats
et prérequis de mise en service. Aucun import effectif/apply n’a été réalisé.
