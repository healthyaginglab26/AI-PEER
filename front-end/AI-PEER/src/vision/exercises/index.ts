/**
 * Exercise Rules Registry
 *
 * Maps exercise IDs to their form-checking rules.
 * Used by FormAnalyzer to look up rules for any exercise.
 */

import { ExerciseRule } from './types';

// Assessment exercises
import { chairRiseRules } from './assessment/chairRise';
import { balanceTestRules } from './assessment/balanceTest';
import { timedUpAndGoRules } from './assessment/timedUpAndGo';

// Warm-up exercises
import { headMovementsRules } from './warmup/headMovements';
import { neckMovementsRules } from './warmup/neckMovements';
import { backMovementsRules } from './warmup/backMovements';
import { trunkMovementsRules } from './warmup/trunkMovements';
import { ankleMovementsRules } from './warmup/ankleMovements';

// Strength exercises
import { kneeExtensorRules } from './strength/kneeExtensor';
import { kneeExtensorRightRules } from './strength/kneeExtensorRight';
import { kneeFlexorRules } from './strength/kneeFlexor';
import { kneeFlexorRightRules } from './strength/kneeFlexorRight';
import { hipAbductorRules } from './strength/hipAbductor';
import { hipAbductorRightRules } from './strength/hipAbductorRight';
import { calfRaisesRules } from './strength/calfRaises';
import { toeRaisesRules } from './strength/toeRaises';

// Balance exercises
import { kneeBendsRules } from './balance/kneeBends';
import { sitToStandRules } from './balance/sitToStand';
import { sidewaysWalkRules } from './balance/sidewaysWalk';
import { backwardsWalkRules } from './balance/backwardsWalk';
import { walkAndTurnRules } from './balance/walkAndTurn';
import { oneLegStandRules } from './balance/oneLegStand';
import { oneLegStandRightRules } from './balance/oneLegStandRight';
import { heelToeStandRules } from './balance/heelToeStand';
import { heelToeWalkRules } from './balance/heelToeWalk';
import { heelWalkingRules } from './balance/heelWalking';
import { toeWalkingRules } from './balance/toeWalking';
import { heelToeWalkBackwardsRules } from './balance/heelToeWalkBackwards';

// PEER Lower Body exercises
import { sitToStandRules1 } from './lowerBody/sitToStand1';
import { sitToStandRules2 } from './lowerBody/sitToStand2';
import { sitToStandRules3 } from './lowerBody/sitToStand3';
import { splitSquatRules1 } from './lowerBody/splitSquat1';
import { splitSquatRules2 } from './lowerBody/splitSquat2';
import { splitSquatRules3 } from './lowerBody/splitSquat3';
import { dbSquatRules1 } from './lowerBody/dbSquat1';
import { dbSquatRules2 } from './lowerBody/dbSquat2';
import { dbSquatRules3 } from './lowerBody/dbSquat3';
import { hipHingeRules1 } from './lowerBody/hipHinge1';
import { hipHingeRules2 } from './lowerBody/hipHinge2';
import { hipHingeRules3 } from './lowerBody/hipHinge3';
import { standHamCurlL1Rules } from './lowerBody/standHamCurlL1';
import { standHamCurlL2Rules } from './lowerBody/standHamCurlL2';
import { standHamCurlL3Rules } from './lowerBody/standHamCurlL3';
import { standHamCurlR1Rules } from './lowerBody/standHamCurlR1';
import { standHamCurlR2Rules } from './lowerBody/standHamCurlR2';
import { standHamCurlR3Rules } from './lowerBody/standHamCurlR3';


/**
 * Registry mapping exercise ID to its rules.
 * Use getExerciseRules(id) to look up rules for an exercise.
 */
export const exerciseRegistry: Record<string, ExerciseRule> = {
  // Assessment (3)
  'assessment-1': chairRiseRules,
  'assessment-2': balanceTestRules,
  'assessment-3': timedUpAndGoRules,

  // Warm-up (5)
  'warmup-1': headMovementsRules,
  'warmup-2': neckMovementsRules,
  'warmup-3': backMovementsRules,
  'warmup-4': trunkMovementsRules,
  'warmup-5': ankleMovementsRules,

  // Strength (5 + 3 right-side)
  'strength-1': kneeExtensorRules,
  'strength-1-right': kneeExtensorRightRules,
  'strength-2': kneeFlexorRules,
  'strength-2-right': kneeFlexorRightRules,
  'strength-3': hipAbductorRules,
  'strength-3-right': hipAbductorRightRules,
  'strength-4': calfRaisesRules,
  'strength-5': toeRaisesRules,

  // Balance (11)
  'balance-1': kneeBendsRules,
  'balance-2': sitToStandRules,
  'balance-3': sidewaysWalkRules,
  'balance-4': backwardsWalkRules,
  'balance-5': walkAndTurnRules,
  'balance-6': oneLegStandRules,
  'balance-6-right': oneLegStandRightRules,
  'balance-7': heelToeStandRules,
  'balance-8': heelToeWalkRules,
  'balance-9': heelWalkingRules,
  'balance-10': toeWalkingRules,
  'balance-11': heelToeWalkBackwardsRules,


  // PEER Lower Body ()
  'lowerBody-1-1': sitToStandRules1,
  'lowerBody-1-2': sitToStandRules2,
  'lowerBody-1-3': sitToStandRules3,
  'lowerBody-2-1': splitSquatRules1,
  'lowerBody-2-2': splitSquatRules2,
  'lowerBody-2-3': splitSquatRules3,
  'lowerBody-3-1': dbSquatRules1,
  'lowerBody-3-2': dbSquatRules2,
  'lowerBody-3-3': dbSquatRules3,
  'lowerBody-4-1': hipHingeRules1,
  'lowerBody-4-2': hipHingeRules2,
  'lowerBody-4-3': hipHingeRules3,
  'lowerBody-5-1l': standHamCurlL1Rules,
  'lowerBody-5-2l': standHamCurlL2Rules,
  'lowerBody-5-3l': standHamCurlL3Rules,
  'lowerBody-5-1r': standHamCurlR1Rules,
  'lowerBody-5-2r': standHamCurlR2Rules,
  'lowerBody-5-3r': standHamCurlR3Rules,
};

/**
 * Get exercise rules by ID.
 * Returns undefined if exercise ID not found.
 */
export function getExerciseRules(exerciseId: string): ExerciseRule | undefined {
  return exerciseRegistry[exerciseId];
}

/**
 * Get all exercises in a category.
 */
export function getExercisesByCategory(category: ExerciseRule['category']): ExerciseRule[] {
  return Object.values(exerciseRegistry).filter((rule) => rule.category === category);
}

/**
 * Get all exercise IDs.
 */
export function getAllExerciseIds(): string[] {
  return Object.keys(exerciseRegistry);
}

// Re-export types and utils
export * from './types';
export * from './utils';
