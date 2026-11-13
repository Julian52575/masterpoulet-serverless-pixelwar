"""Command sequencing only: no cloud command is executed."""
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import deploy
import destroy


class PowerScriptsTests(unittest.TestCase):
    def test_deploy_order(self):
        with patch.object(deploy, "arguments", return_value=(SimpleNamespace(plan_only=True), ("dev",))), patch.object(deploy, "initialize"), patch.object(deploy, "arc_ready"), patch.object(deploy, "plan_apply") as plan:
            deploy.main()
        self.assertEqual([c.args[0] for c in plan.call_args_list], ["foundation", "gke", "runners"])
        self.assertIn("-var=enable_nat=true", plan.call_args_list[0].args)

    def test_destroy_order_and_protection(self):
        with patch.object(destroy, "arguments", return_value=(SimpleNamespace(plan_only=True), ("prod",))), patch.object(destroy, "initialize"), patch.object(destroy, "terraform", return_value=SimpleNamespace(stdout="google_container_cluster.gke\n")), patch.object(destroy, "plan_apply") as plan:
            destroy.main()
        self.assertEqual([c.args[0] for c in plan.call_args_list], ["runners", "gke", "gke", "foundation"])
        self.assertIn("-target=google_container_cluster.gke", plan.call_args_list[1].args)
        self.assertTrue(plan.call_args_list[2].kwargs["destroy"])
        self.assertIn("-var=enable_nat=false", plan.call_args_list[3].args)
        self.assertNotIn("destroy", plan.call_args_list[3].kwargs)

    def test_empty_gke_skips_protection_apply(self):
        with patch.object(destroy, "arguments", return_value=(SimpleNamespace(plan_only=True), ("dev",))), patch.object(destroy, "initialize"), patch.object(destroy, "terraform", return_value=SimpleNamespace(stdout="")), patch.object(destroy, "plan_apply") as plan:
            destroy.main()
        self.assertEqual(len(plan.call_args_list), 3)

    def test_one_confirmation_can_cancel_all_destruction(self):
        with patch.object(destroy, "arguments", return_value=(SimpleNamespace(plan_only=False), ("dev", "prod"))), patch("builtins.input", return_value="NON") as question, patch.object(destroy, "initialize") as init:
            destroy.main()
        question.assert_called_once()
        init.assert_not_called()

    def test_plan_only_never_applies(self):
        with patch.object(deploy, "terraform") as tf, patch.object(deploy.Path, "unlink"):
            deploy.plan_apply("gke", "dev", True, destroy=True)
        self.assertEqual(tf.call_args.args[2], "plan")
        self.assertIn("-destroy", tf.call_args.args)
        self.assertEqual(tf.call_count, 1)

    def test_failure_stops_the_sequence(self):
        with patch.object(deploy, "arguments", return_value=(SimpleNamespace(plan_only=True), ("dev",))), patch.object(deploy, "initialize"), patch.object(deploy, "plan_apply", side_effect=OSError("failure")) as plan:
            with self.assertRaises(OSError):
                deploy.main()
        self.assertEqual(plan.call_count, 1)


if __name__ == "__main__":
    unittest.main()
