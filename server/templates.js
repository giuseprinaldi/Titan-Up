// Built-in retro formats and health-check dimension sets.
// Column "hue" names map to CSS custom properties in public/styles.css.

export const RETRO_TEMPLATES = [
  {
    id: 'start-stop-continue',
    name: 'Start, Stop, Continue',
    blurb: 'Decide what to begin, what to drop, and what to keep.',
    columns: [
      { id: 'start', title: 'Start', prompt: 'What should we begin doing?', hue: 'teal' },
      { id: 'stop', title: 'Stop', prompt: 'What should we quit doing?', hue: 'rose' },
      { id: 'continue', title: 'Continue', prompt: 'What is working and worth keeping?', hue: 'blue' },
    ],
  },
  {
    id: 'well-improve-ideas',
    name: 'Went well, To improve, Ideas',
    blurb: 'The all-purpose format for a regular sprint.',
    columns: [
      { id: 'well', title: 'Went well', prompt: 'What are you pleased with?', hue: 'teal' },
      { id: 'improve', title: 'To improve', prompt: 'What got in the way?', hue: 'rose' },
      { id: 'ideas', title: 'Ideas', prompt: 'What could we try next?', hue: 'gold' },
    ],
  },
  {
    id: 'mad-sad-glad',
    name: 'Mad, Sad, Glad',
    blurb: 'Lead with how the work felt.',
    columns: [
      { id: 'mad', title: 'Mad', prompt: 'What frustrated you?', hue: 'rose' },
      { id: 'sad', title: 'Sad', prompt: 'What disappointed you?', hue: 'blue' },
      { id: 'glad', title: 'Glad', prompt: 'What made you happy?', hue: 'gold' },
    ],
  },
  {
    id: 'four-ls',
    name: 'Liked, Learned, Lacked, Longed for',
    blurb: 'Good after a project or a long release.',
    columns: [
      { id: 'liked', title: 'Liked', prompt: 'What did you enjoy?', hue: 'teal' },
      { id: 'learned', title: 'Learned', prompt: 'What do you know now that you did not before?', hue: 'blue' },
      { id: 'lacked', title: 'Lacked', prompt: 'What was missing?', hue: 'rose' },
      { id: 'longed', title: 'Longed for', prompt: 'What do you wish you had?', hue: 'violet' },
    ],
  },
  {
    id: 'sailboat',
    name: 'Sailboat',
    blurb: 'Picture the team as a boat heading somewhere.',
    columns: [
      { id: 'wind', title: 'Wind', prompt: 'What is pushing us forward?', hue: 'teal' },
      { id: 'anchors', title: 'Anchors', prompt: 'What is holding us back?', hue: 'rose' },
      { id: 'rocks', title: 'Rocks', prompt: 'What risks are ahead?', hue: 'gold' },
      { id: 'island', title: 'Island', prompt: 'Where are we trying to get to?', hue: 'violet' },
    ],
  },
];

export const RADAR_TEMPLATES = [
  {
    id: 'team-health',
    name: 'Team health',
    dimensions: [
      { name: 'Delivering value', description: 'We ship things our users and stakeholders care about.' },
      { name: 'Pace', description: 'We get work done without long waits or constant rushing.' },
      { name: 'Quality', description: 'We are proud of what we build and it rarely bites us later.' },
      { name: 'Ownership', description: 'We decide how to do our work and can act on our decisions.' },
      { name: 'Collaboration', description: 'We help each other and it is easy to ask for a hand.' },
      { name: 'Learning', description: 'We are getting better at what we do and have time to grow.' },
      { name: 'Clear goals', description: 'We know what we are aiming for and why it matters.' },
      { name: 'Tools and support', description: 'We have the tooling and outside help we need.' },
      { name: 'Enjoyment', description: 'We like working here, with each other.' },
    ],
  },
  {
    id: 'sprint-habits',
    name: 'Sprint habits',
    dimensions: [
      { name: 'Planning', description: 'We commit to a realistic amount of well-understood work.' },
      { name: 'Focus', description: 'We finish what we start before pulling in more.' },
      { name: 'Flow', description: 'Work moves steadily; little sits blocked or waiting for review.' },
      { name: 'Feedback', description: 'We show work early and hear back quickly.' },
      { name: 'Improvement', description: 'Our retro actions actually get done.' },
      { name: 'Sustainability', description: 'We could keep up this pace indefinitely.' },
    ],
  },
];

export const RATING_LABELS = ['Struggling', 'Shaky', 'Okay', 'Good', 'Thriving'];
