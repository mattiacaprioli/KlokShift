import { ScrollView, Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { BlurCard } from "@/components/ui/BlurCard";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { GoldButton } from "@/components/ui/GoldButton";
import { Pill } from "@/components/ui/Pill";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ShimmerText } from "@/components/ui/ShimmerText";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-8">
      <Text className="mb-3 text-xs font-sans-bold uppercase tracking-wide text-t3">
        {title}
      </Text>
      {children}
    </View>
  );
}

export default function ComponentsScreen() {
  // Dev-only demo route: never render in a production build, even via deep link.
  if (!__DEV__) return null;
  return (
    <ScrollView className="flex-1 bg-bg-1" contentContainerClassName="p-5">
      <Block title="ShimmerText">
        <ShimmerText fontSize={36}>KlokShift</ShimmerText>
      </Block>

      <Block title="GoldButton">
        <View className="gap-3">
          <GoldButton label="Pubblica turno" onPress={() => {}} />
          <GoldButton label="Disabilitato" disabled onPress={() => {}} />
        </View>
      </Block>

      <Block title="Pill — status">
        <View className="flex-row flex-wrap gap-2">
          <Pill label="In attesa" variant="pending" />
          <Pill label="Accettata" variant="accepted" />
          <Pill label="Rifiutata" variant="rejected" />
          <Pill label="Annullata" variant="cancelled" />
          <Pill label="Aperto" variant="open" />
          <Pill label="Chiuso" variant="closed" />
          <Pill label="Neutro" variant="neutral" />
        </View>
      </Block>

      <Block title="Avatar">
        <View className="flex-row items-center gap-3">
          <Avatar name="Mario Rossi" />
          <Avatar name="Giulia Bianchi" size={56} />
          <Avatar name="Luca Verdi" size={40} />
        </View>
      </Block>

      <Block title="Card">
        <Card>
          <Text className="text-base font-sans-semibold text-t1">Trattoria da Gino</Text>
          <Text className="mt-1 text-sm text-t2">Cameriere — Sabato sera</Text>
          <View className="mt-3 flex-row items-center justify-between">
            <Pill label="Aperto" variant="open" />
            <Text className="text-sm font-sans-semibold text-gold">12€/h</Text>
          </View>
        </Card>
      </Block>

      <Block title="BlurCard">
        <BlurCard>
          <Text className="text-base font-sans-semibold text-t1">Turno premium</Text>
          <Text className="mt-1 text-sm text-t2">
            Effetto blur su sfondo scuro
          </Text>
        </BlurCard>
      </Block>

      <Block title="SectionHeader">
        <SectionHeader title="Turni vicini" actionLabel="Vedi tutti" onAction={() => {}} />
        <Card>
          <Text className="text-sm text-t2">Contenuto sezione…</Text>
        </Card>
      </Block>

      <Block title="EmptyState">
        <Card>
          <EmptyState
            title="Nessun turno disponibile"
            subtitle="Torna più tardi per nuove opportunità"
          />
        </Card>
      </Block>
    </ScrollView>
  );
}
