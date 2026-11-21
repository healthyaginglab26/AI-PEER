//
//  FormAnalyzer.ts
//
//
//
//
import {getExerciseRules} from "@/src/vision/exercises"
import {Pose, Keypoint, FormFeedback, FormViolation} from "./types"
import {AngleCheck, AlignmentCheck, PositionCheck, FormCheck, RepConfig} from "@/src/vision/exercises/types"
import {calculateAngle, angleFromVertical, angleFromHorizontal, isAbove, isBelow} from "@/src/vision/exercises/utils"


export function analyzePose(pose:Pose, exerciseId:string, overrideRules?:import('./exercises/types').ExerciseRule):FormFeedback{
    const violations:FormViolation[]=[];

    const rules=overrideRules ?? getExerciseRules(exerciseId);

    if(rules){
        for(const check of rules.checks){
            if (check.type==='angle'){
                const result=checkAngle(pose,check,rules.repConfig);
                if (result){
                    violations.push(result);
                }
            }
            if(check.type==='alignment'){
                const result=checkAlignment(pose,check);
                if (result){
                    violations.push(result);
                }
            }
            if(check.type==='position'){
                const result=checkPosition(pose,check);
                if (result){
                    violations.push(result);
                }
            }
        }
    }

    const score=calculateScore(violations);
    return {
        violations,
        score,
        isGoodForm: score >=60
    }

}

function getKeypoint(pose:Pose,name:string):Keypoint|undefined{
    if (!pose.keypoints.find(x=>x.name === name)){
        return undefined;
    }
    return pose.keypoints.find(x=>x.name === name);
}

function checkAngle(pose:Pose, check:AngleCheck, repConfig?:RepConfig):FormViolation|null{
    const keypoint_1=getKeypoint(pose,check.keypoints[0]);
    const keypoint_2=getKeypoint(pose,check.keypoints[1]);
    const keypoint_3=getKeypoint(pose,check.keypoints[2]);

    if(!keypoint_1||!keypoint_2||!keypoint_3){
        return null;
    }

    const angle:number=calculateAngle(keypoint_1,keypoint_2,keypoint_3);

    // gate on rep zones: only fire when the user is in the dead zone between
    // start and end positions of the rep, not while resting at either pole
    if (check.gateOnRepZones && repConfig){
        const inStartZone=angle>=repConfig.startMin && angle<=repConfig.startMax;
        const inEndZone=angle>=repConfig.endMin && angle<=repConfig.endMax;
        if (inStartZone || inEndZone){
            return null;
        }
    }

    if (angle>=check.min && angle<=check.max){
        return null;
    }

    // grade severity if thresholds are set, else fall back to the default
    const outsideBy=Math.max(check.min-angle, angle-check.max, 0);
    const severity=gradeSeverity(outsideBy, check.severityThresholds, check.severity);

    return{
        bodyPart:check.keypoints[1],
        message:check.message,
        severity,
    };
}

function checkAlignment(pose:Pose,check:AlignmentCheck):FormViolation|null{
    const keypoint_1=getKeypoint(pose,check.keypoints[0]);
    const keypoint_2=getKeypoint(pose,check.keypoints[1]);

    if(!keypoint_1||!keypoint_2){
        return null;
    }

    let offBy:number=0;
    let triggered:boolean=false;

    if (check.direction==='vertical'){
        const vert_angle:number=angleFromVertical(keypoint_1,keypoint_2);
        if (vert_angle>=check.tolerance){
            offBy=vert_angle-check.tolerance;
            triggered=true;
        }
    }

    if (check.direction==='horizontal'){
        const hor_angle:number=angleFromHorizontal(keypoint_1,keypoint_2);
        if (hor_angle>=check.tolerance){
            offBy=hor_angle-check.tolerance;
            triggered=true;
        }
    }

    if (!triggered) return null;

    const severity=gradeSeverity(offBy, check.severityThresholds, check.severity);
    return{
        bodyPart:check.keypoints[1],
        message:check.message,
        severity,
    };
}

// shared helper used by checkAngle and checkAlignment.
// `outsideBy` is degrees outside the acceptable range / over tolerance.
// returns the graded severity if thresholds are set, otherwise the default.
function gradeSeverity(
    outsideBy:number,
    thresholds:{moderate:number,severe:number}|undefined,
    defaultSeverity:'warning'|'error',
):FormViolation['severity']{
    if (!thresholds) return defaultSeverity;
    if (outsideBy >= thresholds.severe) return 'severe';
    if (outsideBy >= thresholds.moderate) return 'moderate';
    return 'mild';
}

function checkPosition(pose:Pose,check:PositionCheck):FormViolation|null{
    const keypoint = getKeypoint(pose, check.keypoint);
    const reference = getKeypoint(pose, check.reference);

    if (!keypoint || !reference) {
        return null;
    }

    let isCorrect = false;

    if (check.relation === 'above') {
        isCorrect = isAbove(keypoint, reference);
    } else if (check.relation === 'below') {
        isCorrect = isBelow(keypoint, reference);
    } else if (check.relation === 'left_of') {
        isCorrect = keypoint.x < reference.x;
    } else if (check.relation === 'right_of') {
        isCorrect = keypoint.x > reference.x;
    }

    if (!isCorrect) {
        return {
            bodyPart: check.keypoint,
            message: check.message,
            severity: check.severity,
        };
    }

    return null;
}


// binary per-frame score: 100 if all checks passed, 0 if any failed.
// the consumer (exercise-session, chair-rise-test) averages per-frame scores
// across the activity, which yields the percentage of frames with all checks
// passing — the form score is "fraction of clean frames" by construction.
// VisionContext recomputes this from the SMOOTHED violations so single-frame
// glitches don't tank the score.
function calculateScore(violations:FormViolation[]):number{
    return violations.length === 0 ? 100 : 0;
}



