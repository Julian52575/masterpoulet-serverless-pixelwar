"""ON: foundation/NAT, GKE, then ARC. Only Terraform changes cloud resources."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent


def arguments(description=__doc__):
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--env", choices=("dev", "prod", "both"))
    parser.add_argument("--plan-only", action="store_true")
    args = parser.parse_args()
    if args.env is None:
        print("Choisis l'environnement :\n1. DEV\n2. PROD\n3. DEV + PROD\n4. Annuler")
        choice = input("> ").strip()
        if choice not in ("1", "2", "3", "4"):
            parser.error("Choix invalide")
        args.env = {"1": "dev", "2": "prod", "3": "both", "4": None}[choice]
    return args, ("dev", "prod") if args.env == "both" else (args.env,) if args.env else ()


def terraform(stack, env, *command, **kwargs):
    config = os.environ.copy()
    config.update(TF_DATA_DIR=str(ROOT / ".terraform-power" / env / stack), TF_WORKSPACE="default")
    Path(config["TF_DATA_DIR"]).mkdir(parents=True, exist_ok=True)
    return subprocess.run(["terraform", f"-chdir={ROOT / 'infra' / stack}", *command],
                          env=config, check=True, text=True, **kwargs)


def initialize(stack, env):
    terraform(stack, env, "init", "-input=false", "-lockfile=readonly", f"-backend-config=backends/{env}.hcl")


def plan_apply(stack, env, plan_only, *variables, destroy=False):
    plan = ROOT / ".terraform-power" / env / stack / "power.tfplan"
    try:
        terraform(stack, env, "plan", "-input=false", "-lock-timeout=60s",
                  f"-var-file={env}.tfvars", f"-out={plan}", *variables,
                  *(["-destroy"] if destroy else []))
        if not plan_only:
            terraform(stack, env, "apply", "-input=false", "-lock-timeout=60s", str(plan))
    finally:
        plan.unlink(missing_ok=True)


def arc_ready(env):
    zone = "europe-west1-b" if env == "dev" else "europe-west3-b"
    cluster = f"masterpoulet-{env}-gke"
    config = os.environ.copy()
    config["KUBECONFIG"] = str(Path.home() / ".kube" / "config")
    connection = subprocess.run([shutil.which("gcloud.cmd") or "gcloud", "container", "clusters", "get-credentials",
                                 cluster, f"--project=masterpoulet-{env}", f"--zone={zone}", "--dns-endpoint"], env=config)
    if connection.returncode:
        raise RuntimeError("Cluster inaccessible : vérifier GKE/API/droits. En plan-only, un cluster prévu "
                           "mais pas encore créé ne permet pas de vérifier ARC.")
    context = f"gke_masterpoulet-{env}_{zone}_{cluster}"
    secret = subprocess.run(["kubectl", "--kubeconfig=" + config["KUBECONFIG"], f"--context={context}",
                             "get", "secret", "github-pat-arc", "-n", "arc-runners",
                             "--ignore-not-found", "-o", "name"], capture_output=True, text=True)
    if secret.returncode or not secret.stdout.strip():
        raise RuntimeError("Vérifier les droits Kubernetes et configurer manuellement, si absent, "
                           "le namespace arc-runners et le Secret github-pat-arc "
                           "(clé github_token), hors Git, puis relancer deploy.py. NAT/GKE peuvent rester actifs.")


def main():
    args, environments = arguments()
    for env in environments:
        for stack in ("foundation", "gke", "runners"):
            if stack == "runners":
                arc_ready(env)
            initialize(stack, env)
            plan_apply(stack, env, args.plan_only, *(["-var=enable_nat=true"] if stack == "foundation" else []))

if __name__ == "__main__":
    try:
        main()
    except (subprocess.CalledProcessError, OSError, RuntimeError, KeyboardInterrupt) as error:
        print(f"Arrêt : {error}\nVérifier les ressources encore facturables avant de relancer.")
        raise SystemExit(1)
