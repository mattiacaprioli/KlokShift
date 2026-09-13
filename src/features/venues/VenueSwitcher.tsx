import { useState } from "react";
import { Modal } from "react-native";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "@/tw";
import { Icon } from "@/components/ui/Icon";
import { Mono } from "@/components/ui/Mono";
import { cn } from "@/lib/cn";
import { useActiveVenue } from "./ActiveVenue";

/**
 * Dove sono? Il nome della sede attiva sotto il saluto, in home.
 *
 * Con **una sola sede** rende esattamente il testo di prima — nessuna chevron,
 * nessun tocco: chi ha un locale solo non deve accorgersi che il multi-sede
 * esiste. Dalla seconda in poi diventa il punto da cui si passa da Roma a Milano.
 *
 * Qui si *passa* tra le sedi; si *gestiscono* dal tab Profilo. Di proposito fuori
 * dalla tab bar, che ha già cinque voci e dove la sede non è una destinazione.
 */
export function VenueSwitcher({ className }: { className?: string }) {
  const { venue, venues, setActiveVenue } = useActiveVenue();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (!venue) return null;

  if (venues.length <= 1) {
    return (
      <Text className={cn("mt-1 text-sm text-t3", className)}>{venue.name}</Text>
    );
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`Sede attiva: ${venue.name}. Tocca per cambiare.`}
        className={cn("mt-1 flex-row items-center gap-1", className)}
      >
        <Text className="text-sm text-t3">{venue.name}</Text>
        <Icon
          name="chevR"
          size={14}
          color="#8C8579"
          style={{ transform: [{ rotate: "90deg" }] }}
        />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          className="flex-1 justify-end bg-black/60"
          onPress={() => setOpen(false)}
        >
          {/* Il Pressable interno ferma il tocco: senza, ogni tap sulla lista
              chiuderebbe il foglio prima di arrivare alla riga. */}
          <Pressable
            onPress={() => {}}
            className="gap-1 rounded-t-3xl border-t border-border-2 bg-bg-card px-5 pb-10 pt-5"
          >
            <Mono gold>Le tue sedi</Mono>

            {venues.map((v) => {
              const active = v.id === venue.id;
              return (
                <Pressable
                  key={v.id}
                  onPress={() => {
                    setActiveVenue(v.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "mt-2 flex-row items-center gap-3 rounded-2xl border px-4 py-3.5",
                    active
                      ? "border-gold/40 bg-gold/10"
                      : "border-border-2 bg-bg-1"
                  )}
                >
                  <View className="flex-1">
                    <Text
                      className={cn(
                        "text-base",
                        active
                          ? "font-sans-semibold text-gold"
                          : "font-sans-medium text-t1"
                      )}
                    >
                      {v.name}
                    </Text>
                    {v.city ? (
                      <Text className="mt-0.5 text-xs text-t3">{v.city}</Text>
                    ) : null}
                  </View>
                  {active ? (
                    <Icon name="check" size={18} color="#EAB54C" />
                  ) : null}
                </Pressable>
              );
            })}

            <Pressable
              onPress={() => {
                setOpen(false);
                router.push("/(manager)/venue/new");
              }}
              className="mt-3 items-center py-2"
            >
              <Text className="text-sm font-sans-semibold text-t2">
                + Aggiungi locale
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
