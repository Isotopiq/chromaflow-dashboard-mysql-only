import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { BookOpen, Search, ExternalLink, Loader2, FileText, Info } from "lucide-react";
import { toast } from "sonner";
import { searchLiterature } from "@/lib/literature-search.functions";
import type { LiteratureResult } from "@/lib/lab-types";

export const Route = createFileRoute("/_shell/literature")({
  component: LiteratureSearchPage,
});

function LiteratureSearchPage() {
  const searchFn = useServerFn(searchLiterature);
  const [metaboliteInput, setMetaboliteInput] = useState("");
  const [source, setSource] = useState<"europepmc" | "pubmed" | "both">("europepmc");
  const [maxPerMetabolite, setMaxPerMetabolite] = useState("5");
  const [results, setResults] = useState<LiteratureResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchedCount, setSearchedCount] = useState(0);

  const parsedMetabolites = metaboliteInput
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const handleSearch = async () => {
    if (parsedMetabolites.length === 0) {
      toast.error("Enter at least one metabolite name");
      return;
    }
    if (parsedMetabolites.length > 10) {
      toast.error("Maximum 10 metabolites per search");
      return;
    }
    setSearching(true);
    setResults(null);
    try {
      const res = await searchFn({
        data: {
          metabolites: parsedMetabolites,
          source,
          maxPerMetabolite: parseInt(maxPerMetabolite, 10),
        },
      });
      setResults(res.results);
      setSearchedCount(res.searchedCount);
      if (res.results.length === 0) {
        toast.info("No results found. Try different metabolite names or broaden your search.");
      } else {
        toast.success(`Found ${res.results.length} article${res.results.length === 1 ? "" : "s"}`);
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Search failed");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Discovery
        </div>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <BookOpen className="h-6 w-6" /> Literature Search
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search published LC-MS methods for your metabolites. Queries Europe PMC and PubMed
          (40M+ articles) for relevant liquid chromatography-mass spectrometry methods.
        </p>
      </div>

      {/* Search input */}
      <Card className="border-border bg-card p-4">
        <div className="grid gap-3">
          <div>
            <Label htmlFor="lit-metabolites">
              Metabolites <span className="text-muted-foreground">(one per line or comma-separated, max 10)</span>
            </Label>
            <Textarea
              id="lit-metabolites"
              value={metaboliteInput}
              onChange={(e) => setMetaboliteInput(e.target.value)}
              rows={5}
              placeholder={"e.g.\nAcetylcholine\nCholine\nBetaine\nCarnitine"}
              className="font-mono text-sm"
            />
            <div className="mt-1 text-[10px] text-muted-foreground">
              {parsedMetabolites.length} metabolite{parsedMetabolites.length === 1 ? "" : "s"} detected
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="lit-source">Search source</Label>
              <Select value={source} onValueChange={(v) => setSource(v as typeof source)}>
                <SelectTrigger id="lit-source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="europepmc">Europe PMC (recommended)</SelectItem>
                  <SelectItem value="pubmed">PubMed (NCBI)</SelectItem>
                  <SelectItem value="both">Both sources</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="lit-max">Max results per metabolite</Label>
              <Select value={maxPerMetabolite} onValueChange={setMaxPerMetabolite}>
                <SelectTrigger id="lit-max"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3</SelectItem>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={handleSearch} disabled={searching || parsedMetabolites.length === 0}>
              {searching ? (
                <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Searching…</>
              ) : (
                <><Search className="mr-1 h-4 w-4" /> Search literature</>
              )}
            </Button>
            {searching && (
              <span className="text-xs text-muted-foreground">
                Querying {source === "both" ? "Europe PMC + PubMed" : source === "europepmc" ? "Europe PMC" : "PubMed"} for {parsedMetabolites.length} metabolite{parsedMetabolites.length === 1 ? "" : "s"}…
              </span>
            )}
          </div>
        </div>
      </Card>

      {/* Info banner */}
      {!results && !searching && (
        <Card className="border-border bg-muted/30 p-4">
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium text-foreground/70">How it works</p>
              <p className="mt-1">
                Enter metabolite names and the app searches published literature for LC-MS methods
                involving those compounds. Results include title, authors, journal, abstract snippet,
                and links to the full paper. Europe PMC covers 40M+ publications including PubMed,
                and requires no API key. Searches are rate-limited to respect public API usage guidelines.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Results */}
      {results && results.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {results.length} article{results.length === 1 ? "" : "s"} found
              {searchedCount > 0 && (
                <span className="ml-2 text-muted-foreground">
                  for {searchedCount} metabolite{searchedCount === 1 ? "" : "s"}
                </span>
              )}
            </h2>
          </div>

          {results.map((r) => (
            <Card key={r.id} className="border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {/* Title */}
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium hover:underline"
                  >
                    {r.title}
                  </a>

                  {/* Authors */}
                  {r.authors.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.authors.slice(0, 5).join(", ")}
                      {r.authors.length > 5 && ` et al.`}
                    </p>
                  )}

                  {/* Journal + year + source */}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                    {r.journal && <span className="italic">{r.journal}</span>}
                    {r.year && <span>· {r.year}</span>}
                    <Badge variant="outline" className="text-[9px]">
                      {r.source === "europepmc" ? "Europe PMC" : "PubMed"}
                    </Badge>
                  </div>

                  {/* Matched metabolites */}
                  {r.matchedMetabolites.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {r.matchedMetabolites.map((m) => (
                        <Badge key={m} variant="secondary" className="text-[10px]">
                          {m}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Abstract snippet */}
                  {r.abstract && (
                    <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">
                      {r.abstract}
                    </p>
                  )}

                  {/* DOI link */}
                  {r.doi && (
                    <a
                      href={`https://doi.org/${r.doi}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-[10px] text-blue-600 hover:underline dark:text-blue-400"
                    >
                      <ExternalLink className="h-3 w-3" /> DOI: {r.doi}
                    </a>
                  )}
                </div>

                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  title="Open article"
                >
                  <FileText className="h-4 w-4" />
                </a>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* No results */}
      {results && results.length === 0 && !searching && (
        <Card className="border-border bg-card p-8">
          <div className="text-center">
            <FileText className="mx-auto mb-2 h-8 w-8 opacity-40" />
            <p className="text-sm text-muted-foreground">
              No articles found. Try:
            </p>
            <ul className="mt-2 mx-auto max-w-xs text-left text-xs text-muted-foreground">
              <li>• Using broader metabolite names</li>
              <li>• Checking spelling</li>
              <li>• Switching to "Both sources"</li>
              <li>• Increasing max results per metabolite</li>
            </ul>
          </div>
        </Card>
      )}
    </div>
  );
}
