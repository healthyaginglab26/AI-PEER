/**
 * Standing Hamstring Curl Level 3
 * Orientation: left shoulder facing camera, standing up
 * Lower Body exercise for functional leg strength
 */

import { ExerciseRule } from '../types';

export const standHamCurlL3Rules: ExerciseRule = {
  id: 'lowerBody-5-3l',
  name: 'Standing Hamstring Curl Left',
  category: 'lowerBody',
  level: 3,
  repConfig: {
    keypoints: ['left_hip', 'left_knee', 'left_ankle'],
    startMin: 160, startMax: 180,
    endMin: 50, endMax: 120,
    targetReps: 12,
  },
  totalSets: 1,
  unilateral: true,
  cameraPrompt: 'Stand sideways so the camera sees your LEFT side — your left shoulder should be the one closest to the camera, not your face. Your full body, from head to feet, must be visible in frame. Place your phone about 6-8 feet away.',
  checks: [
    {
      type: 'angle',
      keypoints: ['left_hip', 'left_knee', 'left_ankle'],
      min: 50,
      max: 120,
      message: 'Bend your knee more',
      severity: 'warning',
      gateOnRepZones: true,
    },
    {
      type: 'alignment',
      keypoints: ['left_shoulder', 'left_hip'],
      direction: 'vertical',
      tolerance: 20,
      message: 'Keep your upper body upright',
      severity: 'warning',
    },
    {
      type: 'alignment',
      keypoints: ['right_hip', 'right_knee'],
      direction: 'vertical',
      tolerance: 15,
      message: 'Keep your standing leg straight',
      severity: 'warning',
    },
    {
      type: 'alignment',
      keypoints: ['left_shoulder', 'right_shoulder'],
      direction: 'horizontal',
      tolerance: 15,
      message: 'Keep your shoulders level',
      severity: 'warning',
    },
    {
      type: 'alignment',
      keypoints: ['left_hip', 'right_hip'],
      direction: 'horizontal',
      tolerance: 15,
      message: 'Keep your hips level',
      severity: 'warning',
    },
    {
      type: 'position',
      keypoint: 'nose',
      reference: 'left_hip',
      relation: 'above',
      message: 'Keep your head up',
      severity: 'warning',
    },
  ],
};
