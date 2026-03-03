import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { BookOpen, Mic, ExternalLink } from "lucide-react";
import type { Persona } from "@/types/database";

interface PersonaPanelProps {
  persona: Persona;
}

export function PersonaPanel({ persona }: PersonaPanelProps) {
  return (
    <div className="p-4 space-y-4">
      {/* Profile */}
      <div className="text-center">
        <Avatar className="h-20 w-20 mx-auto mb-3">
          {persona.image_url && <AvatarImage src={persona.image_url} />}
          <AvatarFallback className="text-2xl font-semibold bg-primary/10 text-primary">
            {persona.name
              .split(" ")
              .map((n) => n[0])
              .join("")}
          </AvatarFallback>
        </Avatar>
        <h3 className="font-semibold text-base">{persona.name}</h3>
        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
          {persona.bio}
        </p>
      </div>

      {/* Expertise */}
      <div>
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Expertise
        </h4>
        <div className="flex flex-wrap gap-1.5">
          {persona.expertise.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs font-normal">
              {tag}
            </Badge>
          ))}
        </div>
      </div>

      <Separator />

      {/* Books */}
      {persona.books_json?.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <BookOpen className="h-3 w-3" />
            Books ({persona.books_json.length})
          </h4>
          <div className="space-y-2">
            {persona.books_json.map((book, i) => (
              <div key={i} className="p-2.5 rounded-lg bg-muted/50">
                <p className="text-sm font-medium">{book.title}</p>
                {book.year && (
                  <p className="text-xs text-muted-foreground">{book.year}</p>
                )}
                {book.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {book.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Podcasts */}
      {persona.podcasts_json?.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Mic className="h-3 w-3" />
            Podcasts & Media ({persona.podcasts_json.length})
          </h4>
          <div className="space-y-2">
            {persona.podcasts_json.map((podcast, i) => (
              <div key={i} className="p-2.5 rounded-lg bg-muted/50">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{podcast.title}</p>
                  {podcast.url && (
                    <a
                      href={podcast.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                {podcast.platform && (
                  <p className="text-xs text-muted-foreground">
                    {podcast.platform}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
