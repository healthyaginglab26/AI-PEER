/**
 * Hip Hinge Level 3
 * Orientation: left shoulder facing camera, standing up
 * Lower Body exercise for functional leg strength
 */

import { ExerciseRule } from '../types';

export const hipHingeRules3: ExerciseRule = {
  id: 'lowerBody-4-3',
  name: 'Hip Hinge',
  category: 'lowerBody',
  level: 3,
  repConfig: {
    mode: 'angle',
    keypoints: ['left_shoulder', 'left_hip', 'left_ankle'],
    startMin: 145, startMax: 180,
    endMin: 35, endMax: 100,
    targetReps: 12
  },
  totalSets: 1,
  cameraPrompt: 'Stand with your left shoulder facing the camera. Your full body, from head to feet, must be visible. Place your phone about 6-8 feet away, propped at roughly chest height while you are standing — a low floor angle does not work well for this exercise.',
  checks: [
    {
      type: 'position',
      keypoint: 'nose',
      reference: 'left_hip',
      relation: 'above',
      message: 'Keep your head looking straight forward',
      severity: 'warning',
    },
  ],
};
