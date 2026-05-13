-- Seed common LC-MS reference analytes (m/z computed for [M+H]+).
INSERT INTO public.analytes (name, formula, mz, rt_expected, library_source)
SELECT v.name, v.formula, v.mz, v.rt_expected, 'system'
FROM (VALUES
  ('Caffeine',       'C8H10N4O2',   195.08765::float8, 3.80::float8),
  ('Acetaminophen',  'C8H9NO2',     152.07060,         2.10),
  ('Theophylline',   'C7H8N4O2',    181.07200,         3.30),
  ('Aspirin',        'C9H8O4',      181.04953,         4.50),
  ('Ibuprofen',      'C13H18O2',    207.13796,         7.80),
  ('Naproxen',       'C14H14O3',    231.10156,         7.20),
  ('Glucose',        'C6H12O6',     181.07066,         1.20),
  ('Sucrose',        'C12H22O11',   343.12349,         1.50),
  ('Tryptophan',     'C11H12N2O2',  205.09715,         3.10),
  ('Phenylalanine',  'C9H11NO2',    166.08626,         2.70),
  ('Tyrosine',       'C9H11NO3',    182.08117,         1.90),
  ('Carnitine',      'C7H15NO3',    162.11246,         1.40),
  ('Reserpine',      'C33H40N2O9',  609.28066,         8.90),
  ('Verapamil',      'C27H38N2O4',  455.29043,         6.40),
  ('Diclofenac',     'C14H11Cl2NO2',296.02396,         8.10)
) AS v(name, formula, mz, rt_expected)
WHERE NOT EXISTS (
  SELECT 1 FROM public.analytes a WHERE a.name = v.name
);
