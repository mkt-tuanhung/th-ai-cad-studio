"""MD CAD AI STUDIO - SAFE REFERENCE VALIDATOR ONLY.

This only evaluates incomplete CNC machine profiles and refuses release.
It does NOT generate NC/G-code, control machines or certify safety.
It is a reference for Claude's real implementation and unit tests.
Usage: python qa/reference_release_gate.py examples/machine_3_router_heads_UNVERIFIED.json
"""
from __future__ import annotations
import json, sys
from pathlib import Path

REQUIRED_QUALIFICATION = (
    'parser_pass','post_backplot_pass','air_cut_pass',
    'first_article_pass','operator_signed','engineer_signed'
)

def release_blockers(machine: dict) -> list[str]:
    errors=[]
    if machine.get('status') != 'VERIFIED':
        errors.append('MACHINE_PROFILE_NOT_VERIFIED')
    controller=machine.get('controller') or {}
    if not (controller.get('name') and controller.get('model') and controller.get('firmware') and controller.get('manual_reference')):
        errors.append('CONTROLLER_ID_OR_MANUAL_MISSING')
    area=machine.get('work_envelope_mm') or {}
    if not all(isinstance(area.get(a),(int,float)) and area[a]>0 for a in 'xyz'):
        errors.append('WORK_ENVELOPE_UNCALIBRATED')
    origin=machine.get('origin') or {}
    if not (origin.get('stock_corner') and origin.get('z_reference') and origin.get('work_offset') and origin.get('home_calibrated')):
        errors.append('STOCK_ORIGIN_UNCALIBRATED')
    fixtures=machine.get('fixtures') or {}
    if not isinstance(fixtures.get('safe_clearance_mm'),(int,float)):
        errors.append('SAFE_Z_NOT_DEFINED')
    heads=machine.get('heads') or []
    if not heads:
        errors.append('NO_TOOL_HEADS')
    for head in heads:
        if not (head.get('activation_mapping_verified') and head.get('offset_calibrated')):
            errors.append(f'HEAD_UNCALIBRATED:{head.get("head_id", "UNKNOWN")}')
        if not all(isinstance((head.get('offset_mm') or {}).get(a),(int,float)) for a in 'xyz'):
            errors.append(f'HEAD_OFFSET_INCOMPLETE:{head.get("head_id", "UNKNOWN")}')
        if not head.get('tools') or not all(t.get('actual_calibrated') and isinstance(t.get('diameter_mm'),(int,float)) for t in head['tools']):
            errors.append(f'TOOLS_NOT_VERIFIED:{head.get("head_id", "UNKNOWN")}')
        if machine.get('motion_policy')=='PARALLEL_QUALIFIED' and not head.get('simultaneous_qualified'):
            errors.append(f'HEAD_PARALLEL_NOT_QUALIFIED:{head.get("head_id", "UNKNOWN")}')
    post=machine.get('postprocessor') or {}
    if not (post.get('id') and post.get('version') and post.get('sha256') and post.get('approved_for_controller')):
        errors.append('POSTPROCESSOR_NOT_APPROVED')
    quali=machine.get('qualification') or {}
    for k in REQUIRED_QUALIFICATION:
        if not quali.get(k):errors.append(f'QUALIFICATION_MISSING:{k}')
    if not quali.get('evidence_refs') or not quali.get('qualified_at'):
        errors.append('QUALIFICATION_EVIDENCE_MISSING')
    if not machine.get('production_export_allowed'):
        errors.append('PRODUCTION_EXPORT_DISABLED')
    # IMPORTANT: Machine-only validation is insufficient; real release must also validate the
    # specific job (stock, geometry hash, fixture mapping, toolpath, post-NC backplot and operator review).
    errors.append('JOB_SPECIFIC_RELEASE_VALIDATION_NOT_IMPLEMENTED_IN_REFERENCE')
    return errors

if __name__=='__main__':
    if len(sys.argv)<2:
        print('usage: python reference_release_gate.py <machine_profile.json>');sys.exit(2)
    machine=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    errs=release_blockers(machine)
    print(json.dumps({'status':'BLOCKED','errors':errs,'note':'Reference intentionally never authorizes production release.'},indent=2))
    sys.exit(0)
