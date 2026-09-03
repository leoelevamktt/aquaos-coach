"""Testes do tracker BYTE: identidade estável, oclusão e detecções frac."""

from __future__ import annotations

import numpy as np
import pytest

from app.tracker import ByteTracker, Detection, Track, TrackSample, bbox_from_keypoints, iou_matrix, person_score, stitch_tracks


def make_detection(center: tuple[float, float], score: float, size: float = 40.0) -> Detection:
    x, y = center
    bbox = np.array([x - size, y - size, x + size, y + size], dtype=np.float64)
    keypoints = np.zeros((17, 2), dtype=np.float64)
    keypoints[:, 0] = x
    keypoints[:, 1] = y
    keypoint_scores = np.full(17, 0.8, dtype=np.float64) if score > 0.3 else np.full(17, 0.2, dtype=np.float64)
    return Detection(bbox=bbox, score=score, keypoints=keypoints, keypoint_scores=keypoint_scores)


def test_iou_matrix_matches_exact_overlap():
    boxes_a = np.array([[0, 0, 10, 10]], dtype=np.float64)
    boxes_b = np.array([[0, 0, 10, 10], [20, 20, 30, 30]], dtype=np.float64)
    overlap = iou_matrix(boxes_a, boxes_b)
    assert overlap[0, 0] == 1.0
    assert overlap[0, 1] == 0.0


def test_person_score_prefers_valid_keypoints():
    scores = np.array([0.9, 0.9, 0.9, 0.05], dtype=np.float64)
    assert person_score(scores) == pytest.approx(0.9)


def test_single_person_keeps_stable_id():
    tracker = ByteTracker()
    active_ids = set()
    for frame in range(40):
        center = (100.0 + 5.0 * frame, 200.0)
        active = tracker.update([make_detection(center, 0.8)], frame, frame / 10.0)
        active_ids.update(track.track_id for track in active)
    assert len(tracker.tracks) == 1
    assert len(active_ids) == 1
    assert tracker.tracks[0].confirmed


def test_low_confidence_detection_keeps_track_alive():
    tracker = ByteTracker()
    # 10 quadros fortes, 10 fracos (mesma posição), 10 fortes novamente.
    for frame in range(30):
        center = (150.0, 150.0)
        score = 0.8 if frame < 10 or frame >= 20 else 0.25
        tracker.update([make_detection(center, score)], frame, frame / 10.0)
    assert len(tracker.tracks) == 1
    assert tracker.tracks[0].hits >= 20


def test_full_occlusion_within_max_age_recovers_identity():
    tracker = ByteTracker(max_age=15)
    for frame in range(28):
        center = (120.0 + 4.0 * frame, 100.0)
        detections = [] if 10 <= frame < 18 else [make_detection(center, 0.8)]
        tracker.update(detections, frame, frame / 10.0)
    assert len(tracker.tracks) == 1
    assert tracker.tracks[0].history[-1].frame_index == 27


def test_low_confidence_alone_never_creates_track():
    tracker = ByteTracker()
    for frame in range(20):
        tracker.update([make_detection((100.0, 100.0), 0.25)], frame, frame / 10.0)
    assert tracker.tracks == []


def test_two_people_get_distinct_ids():
    tracker = ByteTracker()
    for frame in range(25):
        detections = [
            make_detection((100.0 + 4.0 * frame, 100.0), 0.8),
            make_detection((400.0 + 4.0 * frame, 100.0), 0.8),
        ]
        tracker.update(detections, frame, frame / 10.0)
    assert len(tracker.tracks) == 2
    ids = {track.track_id for track in tracker.tracks}
    assert len(ids) == 2
    assert all(len(track.history) == 25 for track in tracker.tracks)


def test_bbox_from_keypoints_ignores_weak_keypoints():
    keypoints = np.array([[0, 0], [10, 10], [100, 100]], dtype=np.float64)
    scores = np.array([0.9, 0.9, 0.05], dtype=np.float64)
    bbox = bbox_from_keypoints(keypoints, scores)
    assert bbox.tolist() == [0.0, 0.0, 10.0, 10.0]


def build_track(track_id: int, samples: list[tuple[float, tuple[float, float]]]) -> Track:
    """Track sintético com histórico direto, para testar a costura isolada."""
    detection = make_detection(samples[0][1], 0.8)
    track = Track(detection, track_id, 0, samples[0][0], n_init=1, max_age=5)
    track.state = "confirmed"
    track.history = []
    for timestamp, center in samples:
        bbox = np.array([center[0] - 40, center[1] - 40, center[0] + 40, center[1] + 40], dtype=np.float64)
        track.history.append(
            TrackSample(
                frame_index=int(timestamp * 10),
                timestamp=timestamp,
                bbox=bbox,
                keypoints=detection.keypoints,
                keypoint_scores=detection.keypoint_scores,
                score=0.8,
                valid_pose=True,
            )
        )
    return track


def test_stitch_merges_fragments_of_the_same_athlete():
    first = build_track(1, [(0.0, (100.0, 100.0)), (2.0, (120.0, 100.0))])
    second = build_track(2, [(4.0, (140.0, 100.0)), (6.0, (160.0, 100.0))])
    merged = stitch_tracks([first, second])
    assert len(merged) == 1
    assert len(merged[0].history) == 4
    assert merged[0].duration == pytest.approx(6.0)


def test_stitch_does_not_merge_when_another_athlete_was_active():
    first = build_track(1, [(0.0, (100.0, 100.0)), (2.0, (120.0, 100.0))])
    bystander = build_track(3, [(2.5, (400.0, 400.0)), (3.5, (410.0, 400.0))])
    second = build_track(2, [(4.0, (140.0, 100.0)), (6.0, (160.0, 100.0))])
    merged = stitch_tracks([first, bystander, second])
    assert len(merged) == 3


def test_stitch_does_not_merge_far_reentry():
    first = build_track(1, [(0.0, (100.0, 100.0)), (2.0, (110.0, 100.0))])
    second = build_track(2, [(4.0, (900.0, 900.0)), (6.0, (910.0, 900.0))])
    assert len(stitch_tracks([first, second])) == 2


def test_stitch_does_not_merge_long_gaps():
    first = build_track(1, [(0.0, (100.0, 100.0)), (2.0, (110.0, 100.0))])
    second = build_track(2, [(10.0, (120.0, 100.0)), (12.0, (130.0, 100.0))])
    assert len(stitch_tracks([first, second])) == 2
