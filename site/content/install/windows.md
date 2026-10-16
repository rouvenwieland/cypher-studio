---
titel: Windows
kurz: SmartScreen · „Weitere Informationen“ · „Trotzdem ausführen“
kurzSigniert: Signiert · öffnet ohne Warnung
---
:::::schritte
::::schritt Setup-Datei öffnen
Öffne die heruntergeladene Datei `{{file.windows}}` mit einem Doppelklick. Du findest sie im Ordner „Downloads“.

![Die heruntergeladene Setup-Datei per Doppelklick öffnen](svg:win-datei)
::::
::::schritt-unsigned Auf „Weitere Informationen“ klicken
Windows zeigt „Der Computer wurde durch Windows geschützt“. Das liegt daran, dass Cypher Studio noch nicht mit einem gekauften Zertifikat signiert ist, nicht an der Datei selbst. Klicke auf **Weitere Informationen**.

![Windows meldet, der Computer sei geschützt worden: auf „Weitere Informationen“ klicken](svg:win-smartscreen-1)
::::
::::schritt-unsigned Name prüfen, dann „Trotzdem ausführen“
Jetzt zeigt Windows den Namen der App. Prüfe, dass dort `{{file.windows}}` steht, und klicke auf **Trotzdem ausführen**.

![Nach „Weitere Informationen“: den App-Namen prüfen und „Trotzdem ausführen“ wählen](svg:win-smartscreen-2)

Wer ganz sicher gehen will, rechnet vorher die [Prüfsumme](/#pruefen) der Datei nach.
::::
::::schritt Installation abschließen
Der Installer richtet Cypher Studio für dein Benutzerkonto ein. Er braucht keine Administratorrechte. Danach startest du Cypher Studio über das Startmenü.
::::
:::::

:::achtung
**Es gibt keinen Knopf „Trotzdem ausführen“?** Dann ist unter Windows 11 wahrscheinlich Smart App Control eingeschaltet. Es lässt unsignierte Programme gar nicht zu. Du findest die Einstellung unter Windows-Sicherheit → App- & Browsersteuerung → Smart App Control.

![Smart App Control: bei „Ein“ gibt es keinen Knopf „Trotzdem ausführen“](svg:win-sac)

Der einzige Weg daran vorbei ist, Smart App Control auszuschalten. Das gilt für deinen ganzen Rechner, und je nach Windows-Version lässt es sich danach nicht wieder einschalten. Überlege dir das gut. Mit einem signierten Cypher Studio entfällt das Problem.
:::

:::tipp
Der Browser blockiert schon den Download („wird nicht häufig heruntergeladen“)? Wähle im Download-Menü **Beibehalten**.

Alternativ ohne Meldung: Rechtsklick auf die Datei, Eigenschaften, unten bei „Sicherheit“ den Haken **Zulassen** setzen, dann öffnen.
:::
