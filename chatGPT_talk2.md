Weiter zum Inhalt
Chatverlauf

Du:
Preparation of Plant Datasets – NDJSON, Sources & Integration Check (+ brief budget review)
Hello Priyamvada Sharma,
 
I’ve now prepared and cleaned the plant data and attached it as NDJSON (one JSON object per line):
Files & contents
species.ndjson – 18,673 plants

Fields: taxonKey, scientificName, canonicalName (used as the botanical name), germanName

➤ 5,464 entries have a German name; entries without a German name will remain in MongoDB but should not be shown in the app for now (to be enriched later).
multimedia.ndjson – 3,166,029 image URLs

Fields: taxonKey, species (original with author), organ (leaf|flower|fruit|bark|habit|other), occurrenceId, url, license, wilsonScore:null (placeholder).

All URLs go through the images.weserv.nl proxy and can be adjusted in quality/size, e.g. with &q=80 (for preview/quiz view/fullscreen).
Sources
GBIF (initially the Pl@ntNet dataset; for general images without organ filters we will later add the datasets listed in Figma).
Wikidata API as an additional source for German names (including deduplication and filtering out “pseudo-translations” that are just the scientific name).
Does this structure work for ingestion into MongoDB?
Brief budget review (transparent & pragmatic)

According to the project plan/effort estimate, with the last invoice in August we are at 39%. Given the remaining tasks, I’m currently unsure whether we’re still on track.

Could you send me an honest short assessment (remaining scope, risks, any additional buffer needed)? This helps me report internally.
Next steps

I expect to share the MongoDB and AWS access on Tuesday.
Thanks you 
species.ndjson
multimedia.ndjson
 
c-walther Thank you for providing the dataset. During our risk analysis, we identified that most of the risks were associated with the dataset itself. We have an internal meeting to plan the next steps in a way that will allow us to accelerate progress on the backend APIs and their integration. 
I will share more details on the remaining scope and any buffer considerations later today if required to give you a clear picture for your internal reporting.
 
Thank you for your patience.
 
 
Hello c-walther, Thank you for sharing this information with us. This input also allows us to plan tasks more effectively, allocate resources with precision, and proceed with improved efficiency and confidence.
 
Here is a brief status update regarding the budget and timeline:
Budget: Development was started on June 13, 2025. As of now, we are at approximately 40% of the overall budget utilization, which is well within the planned allocation for this stage of the project.
Timeline: Based on the current progress, the overall project duration is estimated to be close to nine months. This would place the projected completion timeframe around February to March 2026.
However, it is important to emphasize that our objective is to complete the project significantly earlier. The team is actively planning and prioritizing tasks with the aim of finalizing the core development as early as possible.
 
There was a slight slowdown in development during the recent period, primarily due to the limitations of GBIF and the need to conduct R&D in order to identify suitable alternatives, along with a few other contributing factors. For instance, part of the effort was dedicated to realigning the design from a more user-intuitive perspective to ensure a smoother experience (The suggestions were provided and we finalized this in call). That said, we are now firmly on the right track and expect the pace of development to pick up steadily moving forward. 
 
Such adjustments are quite normal in any software development lifecycle, and it is in fact a positive outcome that we were able to identify and address major risks and challenges at an early stage. This will ultimately contribute to a more stable and scalable final product.
Priyamvada Sharma will continue to provide you with frequent updates to keep you informed of progress.
 
If you have any further concerns regarding project management, development, or any other aspect of the work, please do not hesitate to reach out to me directly. I am available to arrange a call to discuss matters in detail and will gladly adjust to your preferred time to ensure a smooth exchange. Thanks
 
 
Hello James, Priyamvada Sharma
 
thank you for the concise status update and the clear timeline. I’m confident we’ll continue making strong progress together.
 
Access: I’ve just invited you Priyamvada to MongoDB and AWS . These are newly created accounts and I’m not yet familiar with both platforms. To keep you unblocked, I’ve initially granted full access. If you need diffrent settings, or notice anything misconfigured, please reach out to me and I’ll adjust it.
 
Data: If the NDJSON structure (species.ndjson, multimedia.ndjson) needs any adjustments for MongoDB import or indexing, let me know and I’ll adapt it.
 
Thanks again—looking forward to the backend integration.
 




Wie du aus dem anderen Chat weißt, habe ich die Daten von GBIF extrahiert und aufbereitet, so das wir sie selbst hosten können. Das war ja ein Problem, das die Agentur hatte, da die API von GBIF etwas eingeschränkt war und so haben wir zukünftig mehr Kontrolle.

Meinen Chef hatte ich das ganz grob angedeutet und auch gesagt, das ich mir nicht ganz sicher bin ob wir vom Budget noch im Rahmen liegen, daher dieser Chat mit der Agentur. Christoph (Mein Chef) sagte mir, das ich das erst einmal abklären soll, bevor er die aktuelle Rechnung begleicht. Jetzt möchte ich ihm alles übersichtlich gebündelt, diplomatisch und klug mitteilen, so das er wieder Vertrauen im Projektablauf gewinnen kann und auch die Rechnung vom August, die ich ihm mit sende begleicht. Die E-Mails soll professionell strukturiert sein. Er soll zudem auch zugriff zu den Datensatz als Anhang und diesem Chatverlauf bekommen. Es sind also folgende Anhänge:

Arbeitsnachweise: Project_MyFlora_(MYF)_01_Aug_25_31_Aug_25
Rechnung für August: 1814_2025-09-03_JAKO_621
und die beiden Datensätze als Links zu OneDrive
ChatGPT:

Nachgedacht für 49s
Hier ist eine saubere, diplomatische Mail an Christoph, die Status, Budget, Risiken und Anhänge klar bündelt und die Zahlungsfreigabe freundlich anstößt. Du kannst sie 1:1 übernehmen (Links bitte einsetzen).

Betreff: MyFlora – Datenbereitstellung, Status & Budget-Update (Bitte um Freigabe August-Rechnung)

Hallo Christoph,

kurz das Wichtigste vorab (TL;DR):

Datenbasis steht: Ich habe die GBIF-Daten extrahiert, bereinigt und so aufbereitet, dass wir sie selbst hosten können (NDJSON, bereit für MongoDB).

Agentur-Status: Nach Rückmeldung von Applaunch liegen wir bei ca. 40 % Budgetnutzung; es gab eine kurze Verlangsamung aufgrund von GBIF-API-Limitationen und notwendigem R&D, die jetzt adressiert sind. Die Agentur plant mit einer Projektdauer von ~9 Monaten (Ziel: früher fertig werden).

Nächste Schritte: Backend-Integration der Daten startet; Zugänge zu MongoDB und AWS sind eingerichtet.

Bitte: Freigabe der August-Rechnung (Beleg angehängt).

1) Stand der Daten & warum das wichtig ist
Ich habe die Pflanzendaten aus GBIF extrahiert und aufbereitet, sodass wir unabhängig von der GBIF-API-Rate-Limits sind und künftig mehr Kontrolle/Performance haben.

Dateien (NDJSON, jeweils 1 Objekt/Zeile):

species.ndjson – 18.673 Pflanzen (Felder: taxonKey, scientificName, canonicalName = Botanikname, germanName; aktuell 5.464 mit deutschem Namen)

multimedia.ndjson – 3.166.029 Bild-URLs (Felder: taxonKey, species, organ [leaf|flower|fruit|bark|habit|other], occurrenceId, url, license, wilsonScore:null)

Technik: Struktur ist MongoDB-tauglich; Indizes können wir gezielt setzen (z. B. auf taxonKey, organ) und bei Bedarf anpassen.

OneDrive-Links (Zugriff für Dich freigeschaltet):

species.ndjson – [Link einsetzen]

multimedia.ndjson – [Link einsetzen]

2) Budget- & Timeline-Einschätzung (Applaunch)
Budgetnutzung: ca. 40 % (Stand laut Agentur; entspricht unserem 39 %-Stand nach August).

Timeline: Gesamt ~9 Monate → Februar/März 2026 als konservative Spanne; die Agentur betont, früher fertig werden zu wollen.

Grund für Verlangsamung: GBIF-API-Einschränkungen + notwendiges R&D (Alternativen prüfen) sowie UI-Feinschliff aus Nutzer-sicht.

Mitigation: Unsere selbst gehosteten Datensätze + freigeschaltete MongoDB/AWS-Zugänge nehmen diese Blocker raus; die Agentur will die Backend-Integration beschleunigen.

3) Nächste Schritte
Backend-Integration der NDJSON-Daten in MongoDB (inkl. sinnvoller Indizes).

API-Endpunkte für App-Funktionen (Suche, Filter nach Organen, Bilder mit Proxy-Parametern etc.).

Monitoring/Transparenz: Kurze zweiwöchentliche Statusnotizen (Scope, Risiken, Puffer), damit wir intern sauber berichten können.

4) Bitte um Freigabe
Anbei findest Du die Arbeitsnachweise und die Rechnung August. Aus meiner Sicht ist die Freigabe sinnvoll, da wir die wesentlichen Risiken (GBIF-Limits) nun adressiert haben und die Integration auf unserer Infrastruktur startet.

Anhänge:

Arbeitsnachweise: Project_MyFlora_(MYF)_01_Aug_25_31_Aug_25 (PDF)

Rechnung August: 1814_2025-09-03_JAKO_621 (PDF)

Chat-Verlauf mit Applaunch (Status/Budget): [Link/Datei einsetzen]

Wenn Du magst, gehe ich die Punkte gerne in 15 Min mit Dir durch.

Viele Grüße
Clemens

Wenn du willst, schreibe ich Dir direkt noch eine kurze Begleitmail an die Buchhaltung (mit Betreff, drei Stichpunkten und den beiden PDFs als Anhang), die Du einfach weiterleiten kannst.

Du:
viel kürzer und übersichtlicher. Die Details kann er sich ja aus dem Chatverlauf nehmen bei Bedarf. Er weiß nur, das es aktuell schwierig war, die Daten zu integrieren. Mehr weiß er bis jetzt nicht. Er weiß schon, das wir bei 40% liegen, also braucht man das nicht zu erwähnen. Klug zu erwähnen, wäre wohl, das die Agentur plant, früher fertig zu werden. Die Freigabe der Rechnung soll nicht so fordernd klingen, ich könnte erwähnen, das es klug war, von der Agentur ein Statusupdate zu erfragen und wir gerne am Donnerstag kurz darüber sprechen können ob das soweit passt.
Formuliere es professionell und denk dran, das er sich technisch nicht so gut auskennt und wenig Zeit hat. Es soll flüssig geschrieben sein
ChatGPT:

Nachgedacht für 17s
Hier ist eine kurze, gut verständliche Mail an Christoph – schlank, diplomatisch und ohne Technik-Details:

Betreff: MyFlora – Daten bereitgestellt + kurzes Status-Update (Rechnung August anbei)

Hallo Christoph,

kurzes Update in drei Punkten:

Datenbasis steht: Ich habe die Pflanzendaten so aufbereitet, dass wir sie künftig selbst hosten. Damit umgehen wir die bisherigen API-Limitierungen und gewinnen Kontrolle & Stabilität.

Agentur-Status: Auf meine Nachfrage gab es ein kompaktes Update von Applaunch. Sie planen konservativ, möchten aber spürbar früher fertig werden. Die nächsten Schritte zur Backend-Integration sind angestoßen.

Transparenz: Gut, dass wir das Status-Update eingefordert haben – so bleiben Scope und Risiken im Blick. Gern am Donnerstag kurz abstimmen, ob das Vorgehen für Dich so passt.

Anhänge/Links:

Arbeitsnachweise: Project_MyFlora_(MYF)_01_Aug_25_31_Aug_25 (PDF)

Rechnung August: 1814_2025-09-03_JAKO_621 (PDF) – zur Prüfung

Datensätze (OneDrive): species.ndjson [Link einfügen], multimedia.ndjson [Link einfügen]

Chat-Zusammenfassung mit Applaunch (Details) [Link/Datei einfügen]

Viele Grüße
Clemens




Keine Datei ausgewähltKeine Datei ausgewählt
ChatGPT kann Fehler machen. Überprüfe wichtige Informationen. Siehe Cookie-Voreinstellungen.
