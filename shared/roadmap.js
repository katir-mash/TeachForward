// Requirements are a reviewed snapshot, not an eligibility determination.
// Keep source metadata and the generator shared by the browser and server.
export const VERIFIED_AT = '2026-11-14';

export const SOURCE_CATALOG = [
  {
    id: 'initial',
    title: 'TEA · Becoming a Classroom Teacher in Texas',
    url: 'https://tea.texas.gov/educators/certification/initial-certification/becoming-classroom-teacher-texas',
    verifiedAt: VERIFIED_AT,
    summary: 'Initial certification generally involves a degree, approved preparation, appropriate exams, application and fingerprinting. Some career and technical education fields have degree exceptions.',
  },
  {
    id: 'alternative',
    title: 'TEA · Alternative Certification Programs',
    url: 'https://tea.texas.gov/educators/preparation-and-continuing-education/becoming-certified-texas-educator-through-alternative-certification-program',
    verifiedAt: VERIFIED_AT,
    summary: 'An approved program determines admission, the certification plan, training, clinical experience or internship, and exam approval for the selected subject and grade level.',
  },
  {
    id: 'university',
    title: 'TEA · University Certification Programs',
    url: 'https://tea.texas.gov/educators/preparation-and-continuing-education/becoming-certified-texas-educator-through-university-program',
    verifiedAt: VERIFIED_AT,
    summary: 'University preparation can combine a degree and certification. The program advises on admission, coursework, clinical preparation and authorized tests.',
  },
  {
    id: 'programs',
    title: 'TEA · Approved Preparation Program Information',
    url: 'https://tea.texas.gov/educators/preparation-and-continuing-education/consumer-information-about-educator-preparation-programs',
    verifiedAt: VERIFIED_AT,
    summary: 'TEA provides approved-program information, an interactive map, certificate offerings and accountability resources. Confirm current offerings directly with the program.',
  },
  {
    id: 'out-of-state',
    title: 'TEA · Out-of-State Certified Educators',
    url: 'https://tea.texas.gov/educators/certification/out-state-certification/out-state-certified-educators',
    verifiedAt: VERIFIED_AT,
    summary: 'A valid, active standard certificate from another U.S. state or territory may support a Review of Credentials. TEA decides Texas requirements and any test exemptions; transfer is not automatic.',
  },
  {
    id: 'international',
    title: 'TEA · Credentials from Another Country',
    url: 'https://tea.texas.gov/educators/certification/out-state-certification/certification-based-credentials-another-country',
    verifiedAt: VERIFIED_AT,
    summary: 'Foreign-certified applicants need degree equivalency, educator preparation with practicum, and a valid, active teaching credential. A detailed evaluation and TEA review determine eligibility.',
  },
  {
    id: 'additional',
    title: 'TEA · Additional Certification by Exam',
    url: 'https://tea.texas.gov/educators/certification/additional-certifications/additional-certification-exam-information',
    verifiedAt: VERIFIED_AT,
    summary: 'Holders of a valid, active Texas standard classroom certificate and a bachelor’s degree may add eligible areas by examination and application. Restrictions apply; this is not initial certification.',
  },
  {
    id: 'tests',
    title: 'TEA · Required Texas Certification Tests',
    url: 'https://tea.texas.gov/sites/default/files/required-and-replacement-test-chart.pdf',
    verifiedAt: VERIFIED_AT,
    summary: 'Tests depend on the precise certificate, grade band and certification purpose. Confirm the current chart and program or TEA approval before registering.',
  },
];

export const PROFILE_OPTIONS = {
  education: [
    { value: 'high-school', label: 'High school / some college' },
    { value: 'associates', label: 'Associate degree' },
    { value: 'bachelors', label: 'Bachelor’s degree' },
    { value: 'masters', label: 'Master’s degree or higher' },
    { value: 'international', label: 'Degree earned outside the U.S.' },
  ],
  certification: [
    { value: 'none', label: 'No teaching certificate' },
    { value: 'texas', label: 'Texas teaching certificate' },
    { value: 'out-of-state', label: 'Another U.S. state / territory' },
    { value: 'other', label: 'Another country / unsure' },
  ],
  subject: [
    { value: 'elementary', label: 'Elementary education' },
    { value: 'mathematics', label: 'Mathematics' },
    { value: 'science', label: 'Science' },
    { value: 'english', label: 'English / language arts' },
    { value: 'undecided', label: 'Still exploring' },
  ],
  time: [
    { value: '1-2', label: '1–2 hours per week' },
    { value: '3-5', label: '3–5 hours per week' },
    { value: '6-plus', label: '6+ hours per week' },
  ],
};

export const SAMPLE_PROFILE = Object.freeze({
  education: 'bachelors', certification: 'none', subject: 'mathematics', time: '3-5',
});

export function validateProfile(profile) {
  const errors = {};
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return { valid: false, errors: { profile: 'Complete your profile to create a roadmap.' } };
  }
  const messages = {
    education: 'Select your highest level of education.',
    certification: 'Select your current certification status.',
    subject: 'Select a subject, or choose Still exploring.',
    time: 'Select the time you can set aside each week.',
  };
  for (const [field, options] of Object.entries(PROFILE_OPTIONS)) {
    if (!options.some(({ value }) => value === profile[field])) errors[field] = messages[field];
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

const sourceById = Object.fromEntries(SOURCE_CATALOG.map((source) => [source.id, source]));
const task = (id, title, description, sourceIds, detail = '', category = 'Requirements') => ({
  id, title, description, sourceIds, detail, category,
  actionLabel: sourceIds.length ? 'Open TEA guidance' : 'Practice this skill',
  actionUrl: sourceIds.length ? sourceById[sourceIds[0]].url : null,
});

const subjectDetails = {
  elementary: {
    focus: 'Elementary education',
    title: 'Explore the elementary grade band',
    detail: 'Ask a program which elementary certificate and grade span match your goal. Confirm whether reading-related testing applies; “elementary” alone is not an exact certificate.',
    exercise: 'Explain a simple pattern',
    prompt: 'Create a short pattern activity for an elementary learner. State one learning goal, model an example, and write one question that checks understanding.',
  },
  mathematics: {
    focus: 'Mathematics',
    title: 'Choose your mathematics grade band',
    detail: 'Decide whether you want to teach younger, middle or high school learners. Ask your program to map your coursework to a specific mathematics certificate before choosing tests.',
    exercise: 'Make an abstract idea concrete',
    prompt: 'Teach the meaning of a fraction using a familiar object. Give an example, anticipate one misconception, and write a question that checks understanding.',
  },
  science: {
    focus: 'Science',
    title: 'Choose your science field and grade band',
    detail: 'Identify your preferred science field and age group. Ask your program to match your coursework to an appropriate certificate; a general interest in science does not determine a test.',
    exercise: 'Turn a question into an investigation',
    prompt: 'Design a safe paper-based investigation about plant growth. State a question, identify what you would compare, and explain how learners could interpret the results.',
  },
  english: {
    focus: 'English / language arts',
    title: 'Choose your language arts grade band',
    detail: 'Select the ages you want to teach and discuss the exact English/language arts certificate with your program. Confirm reading-related requirements for that certificate.',
    exercise: 'Help a learner support a claim',
    prompt: 'Choose a short text you know. Draft a claim about it, identify evidence, and write two prompts that help a learner explain how the evidence supports the claim.',
  },
  undecided: {
    focus: 'Subject exploration',
    title: 'Compare two subjects and age groups',
    detail: 'List two subjects you enjoy explaining and the learner ages you prefer. Discuss both options with an approved program before committing to a certificate or test.',
    exercise: 'Find the teaching you enjoy',
    prompt: 'List two ideas you enjoy explaining to others. Draft a short explanation of each, then reflect on which age group and subject you would like to explore further.',
  },
};

function createWeeklyPlan(profile, firstTitle, subject) {
  const pace = {
    '1-2': [
      ['One focused research session', `Spend part of your available time on “${firstTitle}”. Write down one question to resolve.`],
      ['One small teaching practice', `Try “${subject.exercise}” once and save a short reflection. Split this over another week if needed.`],
    ],
    '3-5': [
      ['Research and reach out', `Work on “${firstTitle}”, then prepare questions for a program or TEA.`],
      ['Practice and reflect', `Try “${subject.exercise}”. Rehearse your explanation and revise it after reviewing your check-for-understanding question.`],
      ['Review your next step', 'Update your checklist and reserve your next research and practice sessions.'],
    ],
    '6-plus': [
      ['Build your evidence folder', `Work on “${firstTitle}” and organize the documents or questions you will need.`],
      ['Compare options in depth', 'Contact the relevant program or TEA, then compare the answers you receive. Do not treat unanswered questions as confirmed requirements.'],
      ['Run a teaching practice cycle', `Try “${subject.exercise}”, rehearse it, request feedback from someone you trust, and revise.`],
      ['Reflect and plan', 'Record what changed and select your next useful action.'],
    ],
  };
  return pace[profile.time].map(([title, description]) => ({ title, description }));
}

export function buildRoadmap(profile) {
  const validation = validateProfile(profile);
  if (!validation.valid) throw new TypeError('A complete, valid profile is required.');
  const subject = subjectDetails[profile.subject];
  const degree = ['bachelors', 'masters'].includes(profile.education);
  const noDegree = ['high-school', 'associates'].includes(profile.education);
  const foreignDegree = profile.education === 'international';
  let route;
  let title;
  let summary;
  let tasks = [];
  const uncertainties = [
    'Your exact certificate, grade band, eligibility, costs and completion timeline must be confirmed with TEA or an approved program. No certification or employment outcome is guaranteed.',
  ];

  if (profile.certification === 'texas') {
    route = 'Texas certificate review';
    title = 'Build on your Texas teaching background';
    summary = 'Start by checking your existing certificate. Your next route depends on its type, status and coverage of your intended teaching area.';
    uncertainties.push('Confirm that your Texas certificate is a valid, active standard classroom teaching certificate. Other certificate types or an expired certificate need individual guidance.');
    if (!degree) uncertainties.push('Confirm your bachelor’s degree or equivalent before considering additional certification by examination.');
    tasks = [
      task('texas-check', 'Check your current Texas certificate', 'Record its type, validity and teaching areas before selecting another route.', ['additional'], 'If your desired area is already covered, ask TEA or your employer which next steps apply. An existing certificate does not mean you need an initial preparation program.'),
      task('texas-area', `Check whether ${subject.focus.toLowerCase()} is already covered`, 'Compare your target subject and grade band with the areas on your certificate.', ['additional', 'tests'], 'For an eligible additional area, a valid active Texas standard classroom certificate and a bachelor’s degree are prerequisites. Exceptions and restrictions apply; verify with TEA.'),
      task('texas-confirm', 'Confirm any additional-area requirements', 'Ask TEA whether an examination-and-application route applies to your intended area.', ['additional', 'tests'], 'Do not register or apply until the applicable requirements are confirmed. Passing a test alone does not add a certificate area.'),
    ];
  } else if (profile.certification === 'out-of-state') {
    route = 'Out-of-state credential review';
    title = 'Explore your route from another U.S. state';
    summary = 'Your existing credential may lead to a TEA Review of Credentials. Texas certification and exam exemptions require an individual decision.';
    uncertainties.push('Your out-of-state certificate must be standard, valid and active when TEA receives the complete application. If it is temporary, expired or not a classroom credential, ask TEA to confirm your route first.');
    if (noDegree) uncertainties.push('Your education answer and existing certificate need individual review. Do not assume degree eligibility from your certificate alone.');
    tasks = [
      task('state-check', 'Verify your out-of-state credential', 'Confirm certificate type, active status, subject and grade levels with the issuing authority.', ['out-of-state'], 'A certificate from another U.S. state or territory does not automatically become a Texas certificate.'),
      task('state-documents', 'Prepare your credential-review documents', 'Use TEA’s current checklist to identify the application, transcripts and credential documentation needed.', ['out-of-state'], foreignDegree ? 'Your degree was earned outside the U.S.; ask TEA which course-by-course evaluation documents are needed for your out-of-state application.' : 'Use the current TEA checklist instead of assuming that prior degree or program completion alone establishes eligibility.'),
      task('state-review', 'Request TEA review when eligible', 'Follow TEA’s credential-review process and keep the review result with your records.', ['out-of-state'], 'Only TEA can decide certification eligibility, additional tests and any test exemptions. Follow the written review outcome.'),
      task('state-next', 'Follow the requirements in your review result', 'Confirm your individual certification, testing and fingerprinting instructions with TEA.', ['out-of-state'], 'Do not presume an exam exemption or select exams from your subject interest alone.'),
    ];
  } else if (profile.certification === 'other') {
    route = 'Credential clarification';
    title = 'Clarify your credential before you commit';
    summary = 'A teaching credential from another country and an uncertain certificate status need clarification before a Texas pathway can be selected.';
    uncertainties.push('Tell TEA the issuing country, credential type, active status and preparation history. If you are simply unsure whether you hold a certificate, confirm that first; this roadmap does not establish review eligibility.');
    tasks = [
      task('foreign-check', 'Identify your teaching credential', 'Locate the issuing authority, validity dates and evidence of educator preparation and teaching practicum.', ['international'], 'For a foreign-certified route, TEA looks for degree equivalency, preparation including practicum, and a valid active teaching credential.'),
      task('foreign-contact', 'Confirm the appropriate route with TEA', 'Ask whether your documents meet the foreign-credential review criteria or whether a Texas preparation program is needed.', ['international'], 'Do not purchase an evaluation based only on this navigator. Ask about current evaluation, language proficiency and document-submission requirements.'),
      task('foreign-documents', 'Prepare the documents TEA confirms', 'Follow the current foreign-credential guidance if TEA confirms that route applies.', ['international'], 'The evaluation must contain sufficient detail for TEA’s decision. Provider recognition is determined during review; this app does not endorse an evaluator.'),
    ];
  } else if (foreignDegree) {
    route = 'International degree clarification';
    title = 'Connect your international degree to a Texas route';
    summary = 'A degree earned abroad is different from a foreign teaching credential. Start with an approved preparation program and clarify degree recognition.';
    uncertainties.push('The level and U.S. equivalency of your international degree are unknown. Ask an approved program what evaluation and admission evidence it accepts. A degree alone does not qualify you for a foreign-certified educator review.');
    tasks = [
      task('degree-equivalency', 'Clarify your degree with an approved program', 'Describe your international degree and ask which equivalency and admission documents are needed.', ['programs', 'international'], 'You reported no teaching certificate. Confirm a preparation-program route rather than assuming eligibility for review as an already-certified foreign educator.'),
      task('international-program', 'Compare appropriate approved preparation programs', 'Ask programs which route fits your evaluated degree, prior coursework and teaching goals.', ['programs', 'alternative'], 'Confirm entry criteria, total costs, attendance commitments and clinical arrangements directly. TeachForward does not establish your admissibility.'),
      task('international-plan', 'Agree a certification plan with your program', 'Have the program confirm the training, clinical experience and tests that apply to you.', ['alternative'], 'Proceed only after your degree and admission questions are resolved.'),
    ];
  } else if (noDegree) {
    route = 'Degree + university preparation';
    title = 'Lay the foundation for your teaching career';
    summary = 'For the classroom subjects in this MVP, explore a university route that combines a bachelor’s degree with approved educator preparation.';
    uncertainties.push('Degree-credit transfer, admission, program duration and scheduling need a university’s review. Certain career and technical education exceptions exist but are outside this subject selection.');
    tasks = [
      task('university-start', 'Explore a degree with teacher preparation', 'Find a university program that combines a bachelor’s degree and approved educator preparation.', ['university', 'initial'], profile.education === 'associates' ? 'Ask an advisor to review your associate-degree credits and explain transfer options; transfer credit is not guaranteed.' : 'Ask an advisor about admission and how your existing college credits, if any, could fit a degree plan.'),
      task('university-compare', 'Talk to an approved university program', 'Ask about admission, transfer credits, learning format, total costs and clinical preparation.', ['university', 'programs'], 'Confirm the program currently offers your intended certificate. Your weekly availability is a planning preference, not an admission or completion guarantee.'),
      task('university-plan', 'Build your degree and certification plan', 'Work with your advisor on degree coursework, educator preparation and authorized testing.', ['university'], 'Use the advisor’s sequence for coursework and clinical preparation. Do not book tests from a generic checklist.'),
    ];
  } else {
    route = 'Alternative / post-baccalaureate preparation';
    title = 'Turn your experience into a teaching pathway';
    summary = 'With a bachelor’s degree or higher and no teaching certificate, compare approved alternative or post-baccalaureate preparation programs.';
    uncertainties.push('Your degree, coursework, admission criteria and intended grade band still need program review. Holding a degree does not establish admission or exam eligibility.');
    tasks = [
      task('program-shortlist', 'Shortlist approved preparation programs', 'Explore alternative or post-baccalaureate options in TEA’s approved-program resources.', ['programs', 'initial'], 'Find programs serving your intended subject and ask whether the offering is currently active.'),
      task('program-compare', 'Ask programs about fit and admission', 'Compare entry criteria, costs, schedule and clinical or internship arrangements directly with programs.', ['alternative'], 'Ask how your prior degree and coursework relate to the selected certificate. Get unanswered questions clarified before committing.'),
      task('program-plan', 'Build a certification plan with your program', 'After admission, confirm training, clinical experience and the exams your program will authorize.', ['alternative'], 'Use the program’s individual plan. This navigator does not determine readiness for classroom placement.'),
    ];
  }

  const subjectSource = {
    texas: 'additional', 'out-of-state': 'out-of-state', other: 'international', none: 'university',
  }[profile.certification];
  const subjectDetail = profile.certification === 'none'
    ? subject.detail
    : subject.detail.replaceAll('your program', 'TEA').replaceAll('a program', 'TEA').replaceAll('an approved program', 'TEA');
  const subjectTask = task(
    `subject-${profile.subject}`, subject.title,
    profile.subject === 'undecided' ? 'Narrow your interests before selecting a certification area.' : `Connect your interest in ${subject.focus.toLowerCase()} to a specific certificate.`,
    ['tests', subjectSource], subjectDetail,
  );
  // Keep the route-defining action first, followed by the subject decision.
  tasks.splice(1, 0, subjectTask);
  tasks.push(task(
    `skill-${profile.subject}`, subject.exercise,
    'Suggested TeachForward practice. This is a learning activity, not a TEA certification requirement.',
    [], subject.prompt, 'Skills',
  ));

  if (profile.certification === 'none') {
    tasks.push(
      task('initial-tests', 'Confirm and complete the appropriate exams', 'Ask your approved program for the exact tests and registration approval for your certificate.', ['initial', 'tests'], 'Your chosen subject alone is insufficient to select an exam. Confirm your grade band and current requirements first.'),
      task('initial-application', 'Apply when your program confirms eligibility', 'Complete the applicable certification application and first-time fingerprinting process when instructed.', ['initial'], 'Your program and TEA confirm eligibility and application steps. A completed TeachForward checklist does not mean that you are certified.'),
    );
  }
  const relevantSourceIds = new Set(tasks.flatMap((item) => item.sourceIds));
  if (foreignDegree || profile.certification === 'other') relevantSourceIds.add('international');
  const paceLabel = PROFILE_OPTIONS.time.find(({ value }) => value === profile.time).label;
  const weeklyPlan = createWeeklyPlan(profile, tasks[0].title, subject);

  return {
    id: `tx-skills-v1:${profile.education}:${profile.certification}:${profile.subject}:${profile.time}`,
    title, summary, routeLabel: route, paceLabel, focus: subject.focus,
    uncertainties, tasks, weeklyPlan,
    skillExercises: [
      { id: `exercise-${profile.subject}`, title: subject.exercise, prompt: subject.prompt },
      { id: 'exercise-feedback', title: 'Check for understanding', prompt: `Review your ${subject.focus.toLowerCase()} explanation. Write one open question and one example of an answer that would reveal a misconception. Revise your explanation to address it.` },
      { id: 'exercise-reflect', title: 'Reflect on your next practice', prompt: 'Write what felt clear, what needed a better example, and one change to try next time. These reflections are suggested practice, not an assessed TEA requirement.' },
    ],
    sources: SOURCE_CATALOG.filter(({ id }) => relevantSourceIds.has(id)),
  };
}
