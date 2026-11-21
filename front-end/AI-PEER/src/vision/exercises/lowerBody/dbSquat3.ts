/**
 * Dumbbell Squat Level 3
 * Orientation: facing camera, standing up
 * Lower Body exercise for functional leg strength
 */

import { ExerciseRule } from '../types';

export const dbSquatRules3: ExerciseRule = {
  id: 'lowerBody-3-3',
  name: 'Dumbbell Squat',
  category: 'lowerBody',
  level: 3,
  repConfig: {
    mode: 'angle3d',
    keypoints: ['left_hip', 'left_knee', 'left_ankle'],
    startMin: 145, startMax: 180,
    endMin: 35, endMax: 100,
    targetReps: 13
  },
  totalSets: 1,
  cameraPrompt: 'Stand facing the camera. Your full body, from head to feet, must be visible. Place your phone about 6-8 feet away, propped at roughly chest height while you are standing — a low floor angle does not work well for this exercise.',
  checks: [
    {
        type: 'distance',
        keypoints: ['left_ankle', 'right_ankle'],
        referenceKeypoints: ['left_hip', 'right_hip'],
        minRatio: 0.5,
        maxRatio: 1.0,
        message: 'Keep your feet narrower than hip width apart',
        severity: 'warning',
    },
    {
      type: 'alignment',
      keypoints: ['left_shoulder', 'right_shoulder'],
      direction: 'horizontal',
      tolerance: 20,
      message: 'Do not tilt your shoulders',
      severity: 'warning',
    },
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
