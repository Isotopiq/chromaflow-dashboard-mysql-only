// Literature search server functions.
// Queries free public APIs (Europe PMC + NCBI E-utilities) to find
// LC-MS methods in the literature for user-entered metabolite lists.
//
// No API key required for basic use (3 req/s without NCBI key).
// Set NCBI_API_KEY env var for higher NCBI rate limits (10 req/s).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-middleware";
import type { LiteratureResult } from "@/lib/lab-types";

const EUROPE_PMC_BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const NCBI_ESEARCH_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const NCBI_ESUMMARY_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// LC-MS method-related search terms appended to each metabolite query
const METHOD_TERMS = [
  '"LC-MS"',
  '"liquid chromatography"',
  '"liquid chromatography-mass spectrometry"',
  'HILIC',
  '"reversed-phase"',
  '"hydrophilic interaction"',
].join(" OR ");

const METHOD_CONTEXT_TERMS = [
  'method',
  'profiling',
  'quantification',
  'quantitation',
  'detection',
  'analysis',
].join(" OR ");

type EuropePmcResult = {
  id: string;
  title: string;
  authorString: string;
  journalTitle: string;
  pubYear: string;
  abstractText: string;
  doi: string;
  pmid: string;
  fullTextUrlList?: {
    fullTextUrl: Array<{ url: string; documentStyle: string; site: string }>;
  };
};

type EuropePmcResponse = {
  hitCount: number;
  resultList: {
    result: EuropePmcResult[];
  };
};

async function searchEuropePmc(
  metabolite: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  // Build query: (metabolite) AND (LC-MS terms) AND (method context terms)
  const query = `(${metabolite}) AND (${METHOD_TERMS}) AND (${METHOD_CONTEXT_TERMS})`;
  const url = `${EUROPE_PMC_BASE}?query=${encodeURIComponent(query)}&format=json&pageSize=${maxResults}&resultType=core`;

  const resp = await fetch(url, {
    headers: { "Accept": "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`Europe PMC search failed: ${resp.status}`);
  }
  const data = (await resp.json()) as EuropePmcResponse;
  const results = data.resultList?.result ?? [];

  return results.map((r) => {
    // Extract full-text URL if available
    let url = `https://europepmc.org/article/med/${r.pmid || r.id}`;
    if (r.doi) {
      url = `https://doi.org/${r.doi}`;
    }
    const fullTextUrls = r.fullTextUrlList?.fullTextUrl ?? [];
    const freeFullText = fullTextUrls.find((u) => u.documentStyle === "pdf" || u.documentStyle === "html");
    if (freeFullText) {
      url = freeFullText.url;
    }

    return {
      id: `epmc-${r.pmid || r.id}`,
      title: r.title || "Untitled",
      authors: r.authorString ? r.authorString.split(", ").slice(0, 10) : [],
      journal: r.journalTitle || "",
      year: r.pubYear ? parseInt(r.pubYear, 10) : null,
      abstract: r.abstractText || "",
      doi: r.doi || null,
      url,
      matchedMetabolites: [metabolite],
      source: "europepmc" as const,
    };
  });
}

type NcbiEsearchResult = {
  esearchresult: {
    idlist: string[];
  };
};

type NcbiEsummaryResult = {
  result: {
    [uid: string]: {
      title: string;
      authors: Array<{ name: string }>;
      fulljournalname: string;
      pubdate: string;
      abstract?: string;
      elocationid?: string;
    };
  };
};

async function searchNcbiPubmed(
  metabolite: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  const apiKey = process.env.NCBI_API_KEY;
  const query = `(${metabolite}) AND ("LC-MS"[Title/Abstract] OR "liquid chromatography"[Title/Abstract] OR HILIC[Title/Abstract]) AND (method[Title/Abstract] OR profiling[Title/Abstract] OR quantification[Title/Abstract])`;

  // Step 1: ESearch to get PMIDs
  const esearchUrl = `${NCBI_ESEARCH_BASE}?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&retmode=json${apiKey ? `&api_key=${apiKey}` : ""}`;
  const esearchResp = await fetch(esearchUrl);
  if (!esearchResp.ok) {
    throw new Error(`NCBI ESearch failed: ${esearchResp.status}`);
  }
  const esearchData = (await esearchResp.json()) as NcbiEsearchResult;
  const pmids = esearchData.esearchresult?.idlist ?? [];
  if (pmids.length === 0) return [];

  // Step 2: ESummary to get article details
  const esummaryUrl = `${NCBI_ESUMMARY_BASE}?db=pubmed&id=${pmids.join(",")}&retmode=json${apiKey ? `&api_key=${apiKey}` : ""}`;
  const esummaryResp = await fetch(esummaryUrl);
  if (!esummaryResp.ok) {
    throw new Error(`NCBI ESummary failed: ${esummaryResp.status}`);
  }
  const esummaryData = (await esummaryResp.json()) as NcbiEsummaryResult;
  const result = esummaryData.result ?? {};

  return pmids.map((pmid) => {
    const article = result[pmid];
    if (!article) return null;
    const doi = article.elocationid?.replace(/^doi:\s*/, "") || null;
    return {
      id: `pubmed-${pmid}`,
      title: article.title || "Untitled",
      authors: (article.authors ?? []).slice(0, 10).map((a) => a.name),
      journal: article.fulljournalname || "",
      year: article.pubdate ? parseInt(article.pubdate.slice(0, 4), 10) : null,
      abstract: article.abstract || "",
      doi,
      url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      matchedMetabolites: [metabolite],
      source: "pubmed" as const,
    } as LiteratureResult;
  }).filter((x): x is LiteratureResult => x !== null);
}

// Deduplicate results by DOI or title, merging matched metabolites
function deduplicate(results: LiteratureResult[]): LiteratureResult[] {
  const byKey = new Map<string, LiteratureResult>();
  for (const r of results) {
    const key = r.doi || r.title.toLowerCase().trim().slice(0, 100);
    const existing = byKey.get(key);
    if (existing) {
      // Merge matched metabolites
      for (const m of r.matchedMetabolites) {
        if (!existing.matchedMetabolites.includes(m)) {
          existing.matchedMetabolites.push(m);
        }
      }
    } else {
      byKey.set(key, { ...r });
    }
  }
  return [...byKey.values()];
}

const SearchInput = z.object({
  metabolites: z.array(z.string().min(1)).min(1).max(10),
  source: z.enum(["europepmc", "pubmed", "both"]).default("europepmc"),
  maxPerMetabolite: z.number().int().min(1).max(20).default(5),
});

export const searchLiterature = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => SearchInput.parse(d))
  .handler(async ({ data }) => {
    const { metabolites, source, maxPerMetabolite } = data;
    const allResults: LiteratureResult[] = [];

    for (let i = 0; i < metabolites.length; i++) {
      const metabolite = metabolites[i].trim();
      if (!metabolite) continue;

      try {
        if (source === "europepmc" || source === "both") {
          const results = await searchEuropePmc(metabolite, maxPerMetabolite);
          allResults.push(...results);
        }
        if (source === "pubmed" || source === "both") {
          // Small delay to respect rate limits (3 req/s without API key)
          if (source === "both") await sleep(350);
          try {
            const results = await searchNcbiPubmed(metabolite, maxPerMetabolite);
            allResults.push(...results);
          } catch {
            // NCBI may rate-limit; continue with Europe PMC results
          }
        }
      } catch {
        // Continue to next metabolite on error
      }

      // Small delay between metabolites to be respectful to APIs
      if (i < metabolites.length - 1) {
        await sleep(200);
      }
    }

    const deduped = deduplicate(allResults);
    // Sort by number of matched metabolites (desc), then by year (desc)
    deduped.sort((a, b) => {
      if (b.matchedMetabolites.length !== a.matchedMetabolites.length) {
        return b.matchedMetabolites.length - a.matchedMetabolites.length;
      }
      return (b.year ?? 0) - (a.year ?? 0);
    });

    return { results: deduped, searchedCount: metabolites.length };
  });
