/**
 * Split Squat Level 1
 * Orientation: stand up with left shoulder closest to camera
 * 
 * Lower Body exercise for functional leg strength
 */

import { ExerciseRule } from '../types';

export const splitSquatRules1: ExerciseRule = {
  id: 'lowerBody-2-1',
  name: 'Split Squat',
  category: 'lowerBody',
  level: 1,
  repConfig: {
    mode: 'angle',
    keypoints: ['right_hip', 'right_knee', 'right_ankle'], 
    startMin: 145, startMax: 180,
    endMin: 50, endMax: 125,
    targetReps: 8,

    secondaryConfig: {
      mode: 'angle',
      keypoints: ['left_hip', 'left_knee', 'left_ankle'],
      startMin: 145, startMax: 180,
      endMin: 50, endMax: 125,
      targetReps: 8
    }
  },
  totalSets: 2,
  cameraPrompt: 'Stand sideways so the camera sees your LEFT side — your left shoulder should be the one facing the camera, not your face. Your full body, from head to feet, must be visible in frame. Place your phone about 6-8 feet away.',
  checks: [
    {
      type: 'position',
      keypoint: 'nose',
      reference: 'left_hip',
      relation: 'above',
      message: 'Keep your chin up',
      severity: 'warning',
    }
  ],
};
