/**
 * Sit to Stand Level 3
 * Orientation: facing camera, seated in chair
 * Lower Body exercise for functional leg strength
 */

import { ExerciseRule } from '../types';

export const sitToStandRules3: ExerciseRule = {
  id: 'lowerBody-1-3',
  name: 'Sit to Stand',
  category: 'lowerBody',
  level: 3,
  repConfig: {
    mode: 'angle3d',
    keypoints: ['left_hip', 'left_knee', 'left_ankle'],
    startMin: 50, startMax: 125,
    endMin: 145, endMax: 180,
    targetReps: 10
  },
  totalSets: 1,
  cameraPrompt: 'Sit in a chair facing the camera. Your full body, from head to feet, must be visible both when seated and when standing. Place your phone about 6-8 feet away, propped at roughly chest height while you are seated — a low floor angle does not work well for this exercise.',
  checks: [
    {
      type: 'alignment',
      keypoints: ['left_shoulder', 'left_hip'],
      direction: 'vertical',
      tolerance: 30,
      message: 'Keep your back straight as you stand',
      severity: 'warning',
    },
    {
      type: 'angle',
      keypoints: ['left_hip', 'left_knee', 'left_ankle'],
      min: 145,
      max: 180,
      message: 'Stand up fully by straightening your knees',
      severity: 'warning',
      gateOnRepZones: true,
    },
    {
      type: 'alignment',
      keypoints: ['left_shoulder', 'right_shoulder'],
      direction: 'horizontal',
      tolerance: 20,
      message: 'Keep your shoulders even',
      severity: 'warning',
    },
    {
      type: 'alignment',
      keypoints: ['left_hip', 'right_hip'],
      direction: 'horizontal',
      tolerance: 20,
      message: 'Keep your hips level as you stand',
      severity: 'warning',
    },
    {
      type: 'position',
      keypoint: 'nose',
      reference: 'left_hip',
      relation: 'above',
      message: 'Keep your chin up',
      severity: 'warning',
    },
  ],
};
