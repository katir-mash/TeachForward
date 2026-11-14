import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoadmap, validateProfile, PROFILE_OPTIONS, SAMPLE_PROFILE, SOURCE_CATALOG } from '../shared/roadmap.js';

test('profile validation rejects missing, malformed and unexpected enum values', () => {
  for (const value of [undefined, null, [], 'profile', {}]) assert.equal(validateProfile(value).valid, false);
  for (const field of Object.keys(PROFILE_OPTIONS)) {
    assert.equal(validateProfile({ ...SAMPLE_PROFILE, [field]: '<script>' }).valid, false);
    assert.ok(validateProfile({ ...SAMPLE_PROFILE, [field]: '' }).errors[field]);
  }
  assert.throws(() => buildRoadmap({}), /valid profile/);
  assert.equal(validateProfile(SAMPLE_PROFILE).valid, true);
});

test('sample and user-entered answers pass through exactly the same deterministic generator', () => {
  assert.deepEqual(buildRoadmap(SAMPLE_PROFILE), buildRoadmap(JSON.parse(JSON.stringify(SAMPLE_PROFILE))));
  assert.equal(buildRoadmap(SAMPLE_PROFILE).routeLabel, 'Alternative / post-baccalaureate preparation');
});

test('education materially changes the route and its first action', () => {
  const degree = buildRoadmap(SAMPLE_PROFILE);
  const noDegree = buildRoadmap({ ...SAMPLE_PROFILE, education: 'high-school' });
  const associate = buildRoadmap({ ...SAMPLE_PROFILE, education: 'associates' });
  const international = buildRoadmap({ ...SAMPLE_PROFILE, education: 'international' });
  assert.notEqual(degree.tasks[0].id, noDegree.tasks[0].id);
  assert.match(noDegree.routeLabel, /university/);
  assert.match(associate.tasks[0].detail, /associate-degree/);
  assert.match(international.routeLabel, /International/);
  assert.match(international.uncertainties.join(' '), /degree alone does not qualify/);
});

test('existing certificates have review routes rather than forced initial certification', () => {
  const texas = buildRoadmap({ ...SAMPLE_PROFILE, certification: 'texas' });
  const state = buildRoadmap({ ...SAMPLE_PROFILE, certification: 'out-of-state' });
  const country = buildRoadmap({ ...SAMPLE_PROFILE, certification: 'other' });
  assert.equal(texas.tasks[0].id, 'texas-check');
  assert.equal(state.tasks[0].id, 'state-check');
  assert.equal(country.tasks[0].id, 'foreign-check');
  for (const route of [texas, state, country]) assert.ok(!route.tasks.some(({ id }) => id === 'initial-application'));
  assert.match(texas.uncertainties.join(' '), /valid, active standard/);
  assert.match(state.uncertainties.join(' '), /standard, valid and active/);
  assert.match(country.summary, /clarification/);
});

test('foreign degree with U.S. certificate keeps the U.S. credential route and adds evaluation clarification', () => {
  const roadmap = buildRoadmap({ ...SAMPLE_PROFILE, education: 'international', certification: 'out-of-state' });
  assert.equal(roadmap.tasks[0].id, 'state-check');
  assert.match(roadmap.tasks.find(({ id }) => id === 'state-documents').detail, /course-by-course/);
});

test('subject changes the decision task and real practice; undecided does not invent a certificate', () => {
  const mathematics = buildRoadmap(SAMPLE_PROFILE);
  const science = buildRoadmap({ ...SAMPLE_PROFILE, subject: 'science' });
  const undecided = buildRoadmap({ ...SAMPLE_PROFILE, subject: 'undecided' });
  assert.notDeepEqual(mathematics.skillExercises, science.skillExercises);
  assert.equal(science.tasks[1].id, 'subject-science');
  assert.match(undecided.tasks[1].title, /Compare/);
});

test('time changes suggested weekly workload without inventing a certification deadline', () => {
  const light = buildRoadmap({ ...SAMPLE_PROFILE, time: '1-2' });
  const deep = buildRoadmap({ ...SAMPLE_PROFILE, time: '6-plus' });
  assert.equal(light.weeklyPlan.length, 2);
  assert.equal(deep.weeklyPlan.length, 4);
  assert.notEqual(light.paceLabel, deep.paceLabel);
  assert.deepEqual(light.tasks.map(({ id }) => id), deep.tasks.map(({ id }) => id));
});

test('all profile combinations generate unique task ids and cite reviewed official sources', () => {
  const known = new Set(SOURCE_CATALOG.map(({ id }) => id));
  for (const education of PROFILE_OPTIONS.education) for (const certification of PROFILE_OPTIONS.certification) {
    for (const subject of PROFILE_OPTIONS.subject) for (const time of PROFILE_OPTIONS.time) {
      const roadmap = buildRoadmap({ education: education.value, certification: certification.value, subject: subject.value, time: time.value });
      assert.equal(new Set(roadmap.tasks.map(({ id }) => id)).size, roadmap.tasks.length);
      assert.ok(roadmap.tasks.length >= 5);
      for (const task of roadmap.tasks) {
        if (task.category === 'Requirements') assert.ok(task.sourceIds.length);
        for (const id of task.sourceIds) assert.ok(known.has(id));
        if (task.category === 'Skills') assert.match(task.description, /not a TEA/);
      }
      for (const source of roadmap.sources) {
        assert.equal(new URL(source.url).hostname, 'tea.texas.gov');
        assert.equal(source.verifiedAt, '2026-11-14');
      }
    }
  }
});
