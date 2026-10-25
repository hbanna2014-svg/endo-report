/**
 * findings-colon.js
 * ---------------------------------------------------------------------------
 * Finding catalogue for Colonoscopy, keyed by anatomical section.
 *
 * Polyp documentation is deliberately rich because it drives the surveillance
 * interval calculation in lib/autoReport.js (size, number, morphology,
 * histology and Paris classification all feed the recommendation engine).
 */

/* -------------------------------------------------------------------------- */
/* Shared polyp builder                                                        */
/* -------------------------------------------------------------------------- */

function polypFinding(id, label, sectionLabel, opts = {}) {
  return {
    id,
    label,
    severity: opts.malignancy ? 'critical' : 'moderate',
    tags: ['polyp', 'resection'],
    fields: [
      { key: 'number', label: 'Number of polyps in this segment', type: 'number', required: true },
      { key: 'size', label: 'Largest polyp size (mm)', type: 'number', required: true },
      {
        key: 'morphology',
        label: 'Morphology',
        type: 'select',
        required: true,
        options: [
          { value: 'sessile', label: 'Sessile (Is)' },
          { value: 'pedunculated', label: 'Pedunculated (Ip)' },
          { value: 'flat / slightly elevated', label: 'Flat / slightly elevated (IIa)' },
          { value: 'flat depressed', label: 'Flat depressed (IIc) — high risk' },
          { value: 'laterally spreading tumour', label: 'Laterally spreading tumour (LST)' },
        ],
      },
      {
        key: 'resection',
        label: 'Resection technique',
        type: 'select',
        required: true,
        options: [
          { value: 'cold snare polypectomy', label: 'Cold snare polypectomy' },
          { value: 'hot snare polypectomy', label: 'Hot snare polypectomy' },
          { value: 'endoscopic mucosal resection (EMR)', label: 'Endoscopic mucosal resection (EMR)' },
          { value: 'piecemeal EMR', label: 'Piecemeal EMR' },
          { value: 'cold forceps biopsy avulsion', label: 'Cold forceps biopsy avulsion' },
          { value: 'left in situ — referred for ESD', label: 'Left in situ — referred for ESD' },
          { value: 'not resected', label: 'Not resected' },
        ],
      },
      {
        key: 'completeness',
        label: 'Resection completeness',
        type: 'select',
        required: true,
        options: [
          { value: 'complete', label: 'Complete' },
          { value: 'piecemeal — complete', label: 'Piecemeal — complete' },
          { value: 'incomplete / residual tissue left', label: 'Incomplete / residual left' },
        ],
      },
    ],
    phrase: `Polyp(s) were identified in the ${sectionLabel}: {number} lesion(s), largest {size} mm, {morphology} morphology, resected by {resection}, resection {completeness}. All retrieved specimens were sent for histopathology.`,
    impression: `Polyp(s) in the ${sectionLabel} — {number} lesion(s), largest {size} mm, {morphology}, {resection}`,
    advice: [
      'Await histopathology to determine the surveillance interval (adenoma vs sessile serrated lesion vs hyperplastic)',
      'Document the number of polyps > 10 mm separately — this drives the surveillance interval',
      'Complete resection should be confirmed at the follow-up colonoscopy',
    ],
  }
}

/* -------------------------------------------------------------------------- */
/* Per-section catalogues                                                      */
/* -------------------------------------------------------------------------- */

export const COLON_FINDINGS = {
  /* ------------------------------------------------------------------ */
  rectum: [
    {
      id: 'normal_rectum',
      label: 'Normal rectum',
      severity: 'normal',
      isNormal: true,
      phrase: 'The rectum was normal with a smooth, glistening mucosa showing a normal vascular pattern and no lesion. Retroflexion in the rectum was normal.',
      impression: null,
      advice: [],
    },
    polypFinding('rectal_polyp', 'Rectal polyp(s)', 'rectum', { plural: true }),
    {
      id: 'haemorrhoids_rectal',
      label: 'Internal haemorrhoids',
      severity: 'mild',
      fields: [
        {
          key: 'grade',
          label: 'Grade',
          type: 'select',
          required: true,
          options: [
            { value: 'Grade I — prominent vascular cushions', label: 'Grade I — prominent cushions' },
            { value: 'Grade II — prolapse reducing spontaneously', label: 'Grade II — reduces spontaneously' },
            { value: 'Grade III — prolapse requiring manual reduction', label: 'Grade III — needs manual reduction' },
            { value: 'Grade IV — irreducible', label: 'Grade IV — irreducible' },
          ],
        },
        {
          key: 'stigmata',
          label: 'Stigmata of bleeding',
          type: 'select',
          required: false,
          options: [
            { value: 'none', label: 'None' },
            { value: 'active bleeding', label: 'Active bleeding' },
            { value: 'recent bleeding — red patches / clot', label: 'Recent bleeding (red patches / clot)' },
          ],
        },
      ],
      phrase: 'Internal haemorrhoids, {grade}, were seen with stigmata of bleeding: {stigmata}.',
      impression: 'Internal haemorrhoids, {grade}',
      advice: [
        'Stool softeners, high fibre diet, adequate fluids, avoidance of straining',
        'Topical treatment (hydrocortisone / local anaesthetic) for symptomatic relief',
        'Consider rubber band ligation or surgical referral if grade II–III with recurrence',
        'Exclude proximal source of bleeding — the colon should be examined completely',
      ],
    },
    {
      id: 'proctitis',
      label: 'Proctitis / inflammatory change',
      severity: 'moderate',
      tags: ['inflammatory', 'biopsy-required'],
      biopsy: true,
      fields: [
        {
          key: 'severity',
          label: 'Endoscopic severity (Mayo 0–3)',
          type: 'select',
          required: true,
          options: [
            { value: '1 — mild erythema and decreased vascularity', label: '1 — Mild' },
            { value: '2 — moderate: friable, erosions, absent vascular pattern', label: '2 — Moderate' },
            { value: '3 — severe: spontaneous bleeding, ulceration', label: '3 — Severe' },
          ],
        },
      ],
      phrase: 'The rectal mucosa was erythematous, oedematous and friable with loss of the vascular pattern, consistent with proctitis (Mayo endoscopic score {severity}).',
      impression: 'Proctitis (Mayo endoscopic score {severity})',
      advice: [
        'Multiple biopsies including from the rectum and more proximal segments to establish the extent of colitis',
        'Topical mesalazine (suppository / enema) as first line',
        'Stool studies to exclude infective colitis and C. difficile before escalating to immunosuppression',
      ],
    },
    {
      id: 'rectal_mass',
      label: 'Rectal mass / suspected malignancy',
      severity: 'critical',
      tags: ['malignancy', 'biopsy-required'],
      biopsy: true,
      fields: [
        { key: 'distance', label: 'Distance from anal verge (cm)', type: 'number', required: true },
        { key: 'size', label: 'Approximate size (cm)', type: 'text', required: true },
        {
          key: 'circumference',
          label: 'Extent around circumference',
          type: 'select',
          required: true,
          options: [
            { value: 'less than one quadrant', label: '< 1 quadrant' },
            { value: 'one to two quadrants', label: '1–2 quadrants' },
            { value: 'more than half of the circumference', label: '> half circumference' },
            { value: 'circumferential with luminal narrowing', label: 'Circumferential with narrowing' },
          ],
        },
      ],
      phrase: 'A proliferative, friable, ulcerated rectal growth was seen at {distance} cm from the anal verge, measuring {size}, involving {circumference}. It bled on contact.',
      impression: 'Rectal growth at {distance} cm — suspected malignancy. Biopsies taken.',
      advice: [
        'Multiple biopsies (6–8) from the lesion — send separately from the margins',
        'Complete colonoscopy to exclude synchronous lesions, unless obstructing — consider CT colonography then',
        'MRI pelvis for rectal cancer staging plus staging CT chest/abdomen',
        'Refer urgently to colorectal multidisciplinary team',
      ],
    },
    {
      id: 'radiation_proctitis',
      label: 'Radiation proctopathy',
      severity: 'moderate',
      tags: ['inflammatory'],
      fields: [
        {
          key: 'grade',
          label: 'Features',
          type: 'select',
          required: true,
          options: [
            { value: 'telangiectasia only', label: 'Telangiectasia only' },
            { value: 'telangiectasia with contact bleeding', label: 'Telangiectasia with contact bleeding' },
            { value: 'ulceration and necrosis', label: 'Ulceration / necrosis' },
          ],
        },
      ],
      phrase: 'The rectal mucosa showed {grade} in a field of previous pelvic radiotherapy.',
      impression: 'Radiation proctopathy — {grade}',
      advice: [
        'Argon plasma coagulation for accessible telangiectasia with bleeding',
        'Topical sucralfate, mesalazine or formalin instillation for refractory bleeding',
        'Review previous radiotherapy records and document the interval',
      ],
    },
    { id: 'rectum_not_examined', label: 'Not examined / not reached', severity: 'unknown', isNegative: true, phrase: 'The rectum could not be adequately assessed.', impression: null, advice: [] },
  ],

  /* ------------------------------------------------------------------ */
  sigmoid: [
    {
      id: 'normal_sigmoid',
      label: 'Normal sigmoid colon',
      severity: 'normal',
      isNormal: true,
      phrase: 'The sigmoid colon was normal with smooth mucosa, a preserved vascular pattern and no polyp, diverticulum or ulcer.',
      impression: null,
      advice: [],
    },
    {
      id: 'diverticulosis_sigmoid',
      label: 'Diverticulosis',
      severity: 'mild',
      tags: ['diverticular'],
      fields: [
        { key: 'number', label: 'Approximate number of diverticula', type: 'text', required: true },
        {
          key: 'complication',
          label: 'Complication',
          type: 'select',
          required: true,
          options: [
            { value: 'uncomplicated', label: 'None — uncomplicated' },
            { value: 'with hyperaemia around the ostia', label: 'Hyperaemia around the ostia' },
            { value: 'with pus and inflammation (diverticulitis)', label: 'Pus / inflammation — diverticulitis' },
            { value: 'with stenosis / stricture in the segment', label: 'Stenosis / stricture in the segment' },
          ],
        },
      ],
      phrase: 'Multiple diverticula ({number}) were seen in the sigmoid colon {complication}.',
      impression: 'Diverticular disease of the sigmoid colon {complication}',
      advice: [
        'High fibre diet and adequate fluid intake; avoid constipating medication where possible',
        'No routine antibiotics for uncomplicated diverticulosis',
        'Interval colonoscopy to exclude malignancy after an episode of complicated diverticulitis',
        'Seek urgent surgical review if features of perforation or abscess present',
      ],
    },
    polypFinding('sigmoid_polyp', 'Sigmoid polyp(s)', 'sigmoid colon', { plural: true }),
    {
      id: 'sigmoid_stricture',
      label: 'Stricture / luminal narrowing',
      severity: 'moderate',
      tags: ['biopsy-consider'],
      fields: [
        {
          key: 'cause',
          label: 'Suspected cause',
          type: 'select',
          required: true,
          options: [
            { value: 'diverticular', label: 'Diverticular' },
            { value: 'ischaemic', label: 'Ischaemic' },
            { value: 'inflammatory / Crohn disease', label: 'Inflammatory / Crohn' },
            { value: 'suspected malignant', label: 'Suspected malignant' },
          ],
        },
        { key: 'traversable', label: 'Traversed', type: 'select', required: true, options: [
          { value: 'yes, with the standard endoscope', label: 'Yes, standard scope' },
          { value: 'yes, with a paediatric scope', label: 'Yes, paediatric scope' },
          { value: 'no — examination limited here', label: 'No — examination limited' },
        ] },
      ],
      phrase: 'A stricture of the sigmoid colon was seen, {cause} in origin, {traversable}. The proximal colon could not be fully assessed.',
      impression: 'Sigmoid stricture — {cause}. Examination proximal to the stricture incomplete.',
      advice: [
        'Multiple biopsies from the stricture to exclude underlying malignancy',
        'CT colonography or barium enema to assess the proximal colon if not traversed',
        'Surgical referral if obstructing, or if malignancy cannot be excluded',
      ],
    },
    {
      id: 'sigmoid_colitis',
      label: 'Colitis in the sigmoid',
      severity: 'moderate',
      tags: ['inflammatory', 'biopsy-required'],
      biopsy: true,
      fields: [
        {
          key: 'continuity',
          label: 'Pattern',
          type: 'select',
          required: true,
          options: [
            { value: 'continuous, extending proximally from the rectum', label: 'Continuous from rectum — ulcerative colitis pattern' },
            { value: 'segmental with skip lesions', label: 'Segmental / skip lesions — Crohn pattern' },
            { value: 'patchy, non-specific', label: 'Patchy, non-specific' },
          ],
        },
      ],
      phrase: 'The sigmoid mucosa was abnormal: erythema, granularity and friability with the pattern being {continuity}.',
      impression: 'Colitis involving the sigmoid colon — {continuity}',
      advice: [
        'Stepwise biopsies, including from normal-appearing segments, to map disease extent',
        'Stool culture, C. difficile toxin and faecal calprotectin',
        'Assess for extraintestinal manifestations and perianal disease',
        'Systematic inflammatory bowel disease assessment if newly diagnosed',
      ],
    },
    polypFinding('sigmoid_lst', 'Laterally spreading / large flat lesion', 'sigmoid colon'),
    notExamined('sigmoid_not_examined', 'sigmoid colon'),
  ],

  /* ------------------------------------------------------------------ */
  descending: [
    normalSegment('normal_descending', 'descending colon'),
    polypFinding('descending_polyp', 'Descending colon polyp(s)', 'descending colon', { plural: true }),
    {
      id: 'diverticulosis_descending',
      label: 'Diverticulosis',
      severity: 'mild',
      tags: ['diverticular'],
      fields: [
        { key: 'number', label: 'Approximate number of diverticula', type: 'text', required: true },
        {
          key: 'complication',
          label: 'Complication',
          type: 'select',
          required: true,
          options: [
            { value: 'without complication', label: 'None — uncomplicated' },
            { value: 'with pus and inflammation (diverticulitis)', label: 'Pus / inflammation — diverticulitis' },
          ],
        },
      ],
      phrase: 'Diverticula ({number}) were present in the descending colon {complication}.',
      impression: 'Diverticular disease of the descending colon',
      advice: ['High fibre diet and adequate fluids', 'Interval colonoscopy after complicated diverticulitis to exclude malignancy'],
    },
    colitisFinding('descending_colitis', 'Colitis in the descending colon', 'descending colon'),
    notExamined('descending_not_examined', 'descending colon'),
  ],

  /* ------------------------------------------------------------------ */
  splenic: [
    normalSegment('normal_splenic', 'splenic flexure'),
    polypFinding('splenic_polyp', 'Splenic flexure polyp(s)', 'splenic flexure', { plural: true }),
    notExamined('splenic_not_examined', 'splenic flexure'),
  ],

  /* ------------------------------------------------------------------ */
  transverse: [
    normalSegment('normal_transverse', 'transverse colon'),
    polypFinding('transverse_polyp', 'Transverse colon polyp(s)', 'transverse colon', { plural: true }),
    colitisFinding('transverse_colitis', 'Colitis in the transverse colon', 'transverse colon'),
    {
      id: 'transverse_redundant',
      label: 'Redundant / elongated transverse colon',
      severity: 'mild',
      tags: ['technical'],
      phrase: 'The transverse colon was elongated and redundant, requiring loop reduction during intubation. There was no mucosal lesion.',
      impression: 'Redundant transverse colon (technical finding only)',
      advice: [],
    },
    notExamined('transverse_not_examined', 'transverse colon'),
  ],

  /* ------------------------------------------------------------------ */
  hepatic: [
    normalSegment('normal_hepatic', 'hepatic flexure'),
    polypFinding('hepatic_polyp', 'Hepatic flexure polyp(s)', 'hepatic flexure', { plural: true }),
    notExamined('hepatic_not_examined', 'hepatic flexure'),
  ],

  /* ------------------------------------------------------------------ */
  ascending: [
    normalSegment('normal_ascending', 'ascending colon'),
    polypFinding('ascending_polyp', 'Ascending colon polyp(s)', 'ascending colon', { plural: true }),
    colitisFinding('ascending_colitis', 'Colitis in the ascending colon', 'ascending colon'),
    {
      id: 'ascending_diverticulosis',
      label: 'Right-sided diverticulosis',
      severity: 'mild',
      tags: ['diverticular'],
      fields: [{ key: 'number', label: 'Approximate number', type: 'text', required: true }],
      phrase: 'Right-sided (true) diverticula ({number}) were seen in the ascending colon.',
      impression: 'Right-sided diverticular disease of the ascending colon',
      advice: ['Usually asymptomatic and require no specific treatment', 'Consider CT if there is right iliac fossa pain to exclude diverticulitis'],
    },
    notExamined('ascending_not_examined', 'ascending colon'),
  ],

  /* ------------------------------------------------------------------ */
  caecum: [
    {
      id: 'normal_caecum',
      label: 'Normal caecum',
      severity: 'normal',
      isNormal: true,
      phrase: 'The caecum was normal with a clear tri-radiate fold configuration, a normal appendiceal orifice and a small amount of clear residual fluid. The caecal pole was reached.',
      impression: null,
      advice: [],
    },
    polypFinding('caecal_polyp', 'Caecal polyp(s)', 'caecum', { plural: true }),
    {
      id: 'appendiceal_orifice_abnormal',
      label: 'Abnormal appendiceal orifice',
      severity: 'moderate',
      tags: ['inflammatory'],
      fields: [
        {
          key: 'appearance',
          label: 'Appearance',
          type: 'select',
          required: true,
          options: [
            { value: 'erythematous and swollen', label: 'Erythematous and swollen' },
            { value: 'pus extruding from the orifice', label: 'Pus extruding from the orifice' },
            { value: 'polypoid tissue protruding', label: 'Polypoid tissue protruding' },
          ],
        },
      ],
      phrase: 'The appendiceal orifice appeared {appearance}.',
      impression: 'Abnormal appendiceal orifice — {appearance}',
      advice: [
        'Correlate with clinical features and cross-sectional imaging (CT/USS) for appendicitis',
        'Consider surgical review',
        'If polypoid tissue is protruding, biopsy and consider referral for endoscopic resection',
      ],
    },
    {
      id: 'caecal_mass',
      label: 'Caecal mass / suspected malignancy',
      severity: 'critical',
      tags: ['malignancy', 'biopsy-required'],
      biopsy: true,
      fields: [
        { key: 'size', label: 'Approximate size (cm)', type: 'text', required: true },
        {
          key: 'obstruction',
          label: 'Obstruction',
          type: 'select',
          required: true,
          options: [
            { value: 'non-obstructing', label: 'Non-obstructing' },
            { value: 'obstructing the ileocaecal valve', label: 'Obstructing the ileocaecal valve' },
          ],
        },
      ],
      phrase: 'A friable, ulcerated caecal mass measuring {size} was seen, {obstruction}. It bled on contact.',
      impression: 'Caecal mass — suspected malignancy. Biopsies taken.',
      advice: [
        'Multiple biopsies (6–8) from the mass',
        'Staging CT chest/abdomen/pelvis',
        'Urgent colorectal multidisciplinary team referral',
      ],
    },
    notExamined('caecum_not_examined', 'caecum'),
  ],

  /* ------------------------------------------------------------------ */
  icv: [
    {
      id: 'normal_icv',
      label: 'Normal ileocaecal valve',
      severity: 'normal',
      isNormal: true,
      phrase: 'The ileocaecal valve appeared normal with a sharp lip and it was competent.',
      impression: null,
      advice: [],
    },
    {
      id: 'icv_adenoma',
      label: 'Polyp / adenoma on the ileocaecal valve',
      severity: 'moderate',
      tags: ['polyp'],
      fields: [
        { key: 'size', label: 'Size (mm)', type: 'number', required: true },
        {
          key: 'resection',
          label: 'Resection technique',
          type: 'select',
          required: true,
          options: [
            { value: 'cold snare polypectomy', label: 'Cold snare polypectomy' },
            { value: 'hot snare polypectomy', label: 'Hot snare polypectomy' },
            { value: 'endoscopic mucosal resection (EMR)', label: 'Endoscopic mucosal resection (EMR)' },
            { value: 'not resected', label: 'Not resected' },
          ],
        },
      ],
      phrase: 'A polyp about {size} mm in size was seen on the ileocaecal valve and was treated with {resection}.',
      impression: 'Ileocaecal valve polyp ({size} mm)',
      advice: ['Await histopathology', 'Ensure complete resection is confirmed at follow-up colonoscopy'],
    },
    {
      id: 'icv_not_intubated',
      label: 'Ileocaecal valve not intubated',
      severity: 'mild',
      isNegative: true,
      phrase: 'The ileocaecal valve was visualised but was not intubated, so the terminal ileum was not examined.',
      impression: 'Terminal ileum not examined (ileocaecal valve not intubated)',
      advice: ['Document the reason — this is important medico-legally if terminal ileal pathology is later suspected', 'Consider repeat examination or imaging if small bowel disease is suspected'],
    },
    notExamined('icv_not_examined', 'ileocaecal valve'),
  ],

  /* ------------------------------------------------------------------ */
  ti: [
    {
      id: 'normal_ti',
      label: 'Normal terminal ileum',
      severity: 'normal',
      isNormal: true,
      phrase: 'The terminal ileum was intubated and appeared normal with a healthy villous pattern and no ulceration, erosion or nodularity.',
      impression: null,
      advice: [],
    },
    {
      id: 'ti_ulceration',
      label: 'Terminal ileal ulceration',
      severity: 'severe',
      tags: ['inflammatory', 'biopsy-required'],
      biopsy: true,
      fields: [
        {
          key: 'pattern',
          label: 'Pattern',
          type: 'select',
          required: true,
          options: [
            { value: 'longitudinal ulcers along the mesenteric border', label: 'Longitudinal ulcers (Crohn pattern)' },
            { value: 'aphthous / small discrete ulcers', label: 'Aphthous ulcers' },
            { value: 'diffuse ulceration', label: 'Diffuse ulceration' },
          ],
        },
      ],
      phrase: 'Ulceration was seen in the terminal ileum: {pattern}. The surrounding mucosa was oedematous.',
      impression: 'Terminal ileal ulceration — {pattern}. Consider Crohn disease / NSAID enteropathy',
      advice: [
        'Ileal biopsies (including from normal-looking mucosa) plus colonic biopsies for inflammatory bowel disease assessment',
        'Faecal calprotectin, CRP, stool culture and C. difficile toxin',
        'Small bowel imaging (MR enterography) to assess the extent of small bowel disease',
        'Review NSAID and other drug history',
      ],
    },
    {
      id: 'ti_lymphoid_hyperplasia',
      label: 'Terminal ileal lymphoid hyperplasia',
      severity: 'mild',
      phrase: 'Diffuse fine nodularity of the terminal ileal mucosa was seen, consistent with lymphoid hyperplasia.',
      impression: 'Terminal ileal lymphoid hyperplasia',
      advice: ['Usually a normal finding in younger patients', 'Biopsy if nodularity is coarse or associated with symptoms'],
    },
    {
      id: 'ti_not_intubated',
      label: 'Terminal ileum not intubated',
      severity: 'mild',
      isNegative: true,
      phrase: 'The terminal ileum was not intubated and therefore not examined.',
      impression: 'Terminal ileum not examined',
      advice: ['Record the reason for non-intubation', 'Consider repeat examination or imaging if small bowel disease is suspected'],
    },
  ],

  /* ------------------------------------------------------------------ */
  anal: [
    {
      id: 'normal_anal',
      label: 'Normal anal canal / perianal region',
      severity: 'normal',
      isNormal: true,
      phrase: 'The anal canal and perianal region were normal. No haemorrhoid, fissure, skin tag or mass was seen.',
      impression: null,
      advice: [],
    },
    {
      id: 'haemorrhoids_external',
      label: 'Haemorrhoidal disease (anal canal)',
      severity: 'mild',
      fields: [
        {
          key: 'grade',
          label: 'Grade',
          type: 'select',
          required: true,
          options: [
            { value: 'Grade I — prominent vascular cushions', label: 'Grade I' },
            { value: 'Grade II — prolapse reducing spontaneously', label: 'Grade II' },
            { value: 'Grade III — prolapse requiring manual reduction', label: 'Grade III' },
            { value: 'Grade IV — irreducible', label: 'Grade IV' },
          ],
        },
        {
          key: 'position',
          label: 'Position',
          type: 'select',
          required: false,
          options: [
            { value: 'at 3, 7 and 11 o clock', label: '3, 7 and 11 o’clock' },
            { value: 'circumferential', label: 'Circumferential' },
            { value: 'single', label: 'Single' },
          ],
        },
      ],
      phrase: 'Haemorrhoids were seen at the anal canal, {grade}, located {position}, with no active bleeding.',
      impression: 'Haemorrhoidal disease, {grade}',
      advice: [
        'Fibre supplementation, adequate fluids, avoidance of straining and prolonged toilet sitting',
        'Rubber band ligation or infrared coagulation for grade II–III disease',
        'Surgical referral (haemorrhoidectomy) for grade IV or refractory symptoms',
      ],
    },
    {
      id: 'anal_fissure',
      label: 'Anal fissure',
      severity: 'moderate',
      fields: [
        {
          key: 'position',
          label: 'Position',
          type: 'select',
          required: true,
          options: [
            { value: 'posterior midline', label: 'Posterior midline' },
            { value: 'anterior midline', label: 'Anterior midline' },
            { value: 'lateral', label: 'Lateral — consider Crohn disease / other cause' },
          ],
        },
        {
          key: 'features',
          label: 'Features',
          type: 'select',
          required: true,
          options: [
            { value: 'acute', label: 'Acute' },
            { value: 'chronic with sentinel pile', label: 'Chronic with sentinel pile' },
            { value: 'chronic with exposed internal sphincter', label: 'Chronic with exposed internal sphincter' },
          ],
        },
      ],
      phrase: 'An anal fissure was seen in the {position} position, {features}.',
      impression: 'Anal fissure ({position}, {features})',
      advice: [
        'Stool softeners, high fibre diet and sitz baths',
        'Topical glyceryl trinitrate 0.2% or diltiazem 2% twice daily for 6–8 weeks',
        'Botulinum toxin injection or lateral internal sphincterotomy if refractory',
        'Consider Crohn disease if the fissure is lateral or atypical',
      ],
    },
    {
      id: 'anal_skin_tag',
      label: 'Perianal skin tag(s)',
      severity: 'mild',
      phrase: 'Skin tags were noted in the perianal region. The anal canal mucosa was normal.',
      impression: 'Perianal skin tags (incidental)',
      advice: [],
    },
    {
      id: 'perianal_abscess_fistula',
      label: 'Perianal abscess / fistula',
      severity: 'severe',
      tags: ['surgical'],
      fields: [
        {
          key: 'type',
          label: 'Type',
          type: 'select',
          required: true,
          options: [
            { value: 'abscess with induration and tenderness', label: 'Abscess with induration' },
            { value: 'single external opening with discharge', label: 'Single external opening with discharge' },
            { value: 'multiple external openings', label: 'Multiple external openings — consider Crohn disease' },
          ],
        },
      ],
      phrase: 'Examination of the perianal region showed {type}.',
      impression: 'Perianal sepsis — {type}',
      advice: [
        'Urgent surgical referral for examination under anaesthesia and drainage',
        'MRI pelvis for complex or recurrent fistulae to define the tract',
        'Assess for Crohn disease, especially with multiple openings or recurrent disease',
      ],
    },
    notExamined('anal_not_examined', 'anal canal'),
  ],
}

/* -------------------------------------------------------------------------- */
/* Shared finding factories                                                    */
/* -------------------------------------------------------------------------- */

function normalSegment(id, sectionLabel) {
  return {
    id,
    label: `Normal ${sectionLabel}`,
    severity: 'normal',
    isNormal: true,
    phrase: `The ${sectionLabel} was normal. The mucosa was smooth with a preserved vascular pattern and there was no polyp, diverticulum, ulcer, erosion or mass.`,
    impression: null,
    advice: [],
  }
}

function notExamined(id, sectionLabel) {
  return {
    id,
    label: 'Not examined / not reached',
    severity: 'unknown',
    isNegative: true,
    phrase: `The ${sectionLabel} could not be adequately assessed.`,
    impression: null,
    advice: [],
  }
}

function colitisFinding(id, label, sectionLabel) {
  return {
    id,
    label,
    severity: 'moderate',
    tags: ['inflammatory', 'biopsy-required'],
    biopsy: true,
    fields: [
      {
        key: 'severity',
        label: 'Endoscopic severity (Mayo 0–3)',
        type: 'select',
        required: true,
        options: [
          { value: '1 — mild erythema and decreased vascularity', label: '1 — Mild' },
          { value: '2 — moderate: friable, erosions, absent vascular pattern', label: '2 — Moderate' },
          { value: '3 — severe: spontaneous bleeding, ulceration', label: '3 — Severe' },
        ],
      },
      {
        key: 'pattern',
        label: 'Distribution',
        type: 'select',
        required: true,
        options: [
          { value: 'continuous', label: 'Continuous — ulcerative colitis pattern' },
          { value: 'segmental with skip lesions', label: 'Segmental / skip lesions — Crohn pattern' },
          { value: 'patchy and non-specific', label: 'Patchy, non-specific' },
        ],
      },
    ],
    phrase: `The mucosa of the ${sectionLabel} was erythematous and friable with loss of the normal vascular pattern, endoscopic severity {severity}; the distribution was {pattern}.`,
    impression: `Colitis involving the ${sectionLabel} — {pattern}, endoscopic severity {severity}`,
    advice: [
      'Take stepwise biopsies including from normal-appearing segments to map disease extent',
      'Stool culture, C. difficile toxin and faecal calprotectin',
      'Consider systematic inflammatory bowel disease assessment if newly diagnosed',
    ],
  }
}
