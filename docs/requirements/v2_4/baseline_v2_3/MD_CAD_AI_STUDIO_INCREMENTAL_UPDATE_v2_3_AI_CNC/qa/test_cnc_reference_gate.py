from pathlib import Path
import json, unittest
from reference_release_gate import release_blockers
ROOT=Path(__file__).resolve().parent.parent
class TestSafeGate(unittest.TestCase):
    def test_draft_profiles_rejected(self):
        for p in (ROOT/'examples').glob('machine*_UNVERIFIED.json'):
            with self.subTest(profile=p.name):
                m=json.loads(p.read_text())
                blockers=release_blockers(m)
                self.assertIn('MACHINE_PROFILE_NOT_VERIFIED',blockers)
                self.assertIn('PRODUCTION_EXPORT_DISABLED',blockers)
    def test_no_bypass_by_switching_allow(self):
        m=json.loads((ROOT/'examples/machine_3_router_heads_UNVERIFIED.json').read_text())
        m['production_export_allowed']=True
        self.assertIn('MACHINE_PROFILE_NOT_VERIFIED',release_blockers(m))
    def test_head_calibration_per_head(self):
        m=json.loads((ROOT/'examples/machine_2_router_heads_UNVERIFIED.json').read_text())
        blockers=release_blockers(m)
        self.assertIn('HEAD_UNCALIBRATED:HEAD_1',blockers)
        self.assertIn('HEAD_UNCALIBRATED:HEAD_2',blockers)
if __name__=='__main__': unittest.main()
