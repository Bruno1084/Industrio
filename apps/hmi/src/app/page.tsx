import { PlantOverview } from "@/components/plant-overview";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      <h1>Industrio HMI</h1>
      <PlantOverview />
    </main>
  );
}
