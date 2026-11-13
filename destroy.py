"""OFF: ARC, GKE, then NAT. Never destroy foundation or bootstrap."""
import subprocess

from deploy import arguments, initialize, plan_apply, terraform


def main():
    args, environments = arguments(__doc__)
    if not environments:
        return
    if not args.plan_only:
        print("ARC et GKE seront supprimés, ainsi que le Secret ARC. Prévoir sa restauration hors Git.")
        if input(f"Éteindre {', '.join(environments)} ? Saisir OUI : ").strip() != "OUI":
            return
    for env in environments:
        initialize("runners", env)
        plan_apply("runners", env, args.plan_only, destroy=True)
        initialize("gke", env)
        # Do not create an absent cluster merely to disable deletion protection.
        resources = terraform("gke", env, "state", "list", capture_output=True).stdout.splitlines()
        if "google_container_cluster.gke" in resources:
            plan_apply("gke", env, args.plan_only, "-var=deletion_protection=false",
                       "-target=google_container_cluster.gke")
        plan_apply("gke", env, args.plan_only, "-var=deletion_protection=false", destroy=True)
        initialize("foundation", env)
        plan_apply("foundation", env, args.plan_only, "-var=enable_nat=false")

if __name__ == "__main__":
    try:
        main()
    except (subprocess.CalledProcessError, OSError, KeyboardInterrupt) as error:
        print(f"Arrêt : {error}\nVérifier les ressources encore facturables avant de relancer.")
        raise SystemExit(1)
