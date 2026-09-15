/* SPDX-License-Identifier: GPL-3.0-or-later */
'use strict';
globalThis.LatexIslandsExamples = [
  {
    id: 'optics', title: 'TikZ · lentille convergente',
    source: String.raw`\begin{tikzpicture}[>=stealth,scale=0.9]
  % Axe optique et lentille mince
  \draw[->,gray] (-4,0) -- (4.8,0) node[right] {$x$};
  \draw[<->,very thick,teal] (0,-2) -- (0,2);
  \node[below left] at (0,0) {$O$};
  \fill (-1.5,0) circle (1.5pt) node[below] {$F$};
  \fill (1.5,0) circle (1.5pt) node[below] {$F'$};

  % Objet AB et image A'B'
  \draw[->,very thick] (-3,0) node[below] {$A$}
    -- (-3,1.5) node[above] {$B$};
  \draw[->,very thick] (3,0) node[above] {$A'$}
    -- (3,-1.5) node[below] {$B'$};

  % Deux rayons remarquables
  \draw[orange,thick,->] (-3,1.5) -- (0,1.5);
  \draw[orange,thick,->] (0,1.5) -- (3.8,-2.3);
  \draw[blue,thick,->] (-3,1.5) -- (0,0);
  \draw[blue,thick,->] (0,0) -- (3.8,-1.9);
\end{tikzpicture}`
  },
  {
    id: 'circuit', title: 'Circuitikz · filtre RC',
    source: String.raw`\usepackage{amsmath}
\usepackage[european]{circuitikz}
\begin{circuitikz}
  \draw (0,0) to[sV,l=$v_e(t)$] (0,3)
    to[R,l=$R$,i=$i(t)$] (4,3)
    to[C,l=$C$,v=$v_s(t)$] (4,0) -- (0,0);
  \draw (4,0) node[ground] {};
  \node at (2,-1.2) {$H(j\omega)=\dfrac{1}{1+jRC\omega}$};
\end{circuitikz}`
  },
  {
    id: 'plot', title: 'PGFPlots · réponse fréquentielle',
    source: String.raw`\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\begin{tikzpicture}
\begin{semilogxaxis}[
  width=10cm,height=6.5cm,
  xlabel={$\omega/\omega_c$},ylabel={Gain (dB)},
  xmin=0.01,xmax=100,ymin=-42,ymax=3,
  grid=both,grid style={gray!15},
  legend pos=south west,
  samples=100,domain=0.01:100
]
  \addplot[teal,very thick] {-10*ln(1+x^2)/ln(10)};
  \addlegendentry{Filtre passe-bas RC}
  \addplot[orange,dashed,thick] coordinates {(1,-42) (1,3)};
  \addlegendentry{Pulsation de coupure}
\end{semilogxaxis}
\end{tikzpicture}`
  },
  {
    id: 'diagram', title: 'TikZ · chaîne d’acquisition',
    source: String.raw`\usetikzlibrary{arrows.meta,positioning}
\begin{tikzpicture}[
  node distance=12mm,
  block/.style={draw=teal,fill=teal!5,rounded corners=3pt,
    minimum width=28mm,minimum height=12mm,align=center},
  >={Stealth},thick
]
  \node[block] (sensor) {Capteur};
  \node[block,right=of sensor] (amp) {Amplification};
  \node[block,below=of amp] (adc) {Conversion\\analogique/numérique};
  \node[block,left=of adc] (mcu) {Microcontrôleur};
  \draw[->] (sensor) -- (amp);
  \draw[->] (amp) -- (adc);
  \draw[->] (adc) -- (mcu);
\end{tikzpicture}`
  },
  {
    id: 'flowchart', title: 'TikZ · flowchart automatique',
    source: String.raw`\begin{tikzpicture}[
  node distance=11mm and 18mm,
  startstop/.style={rectangle,rounded corners,draw,minimum width=28mm,minimum height=9mm,align=center},
  decision/.style={diamond,aspect=2,draw,align=center},
  io/.style={trapezium,trapezium left angle=70,trapezium right angle=110,draw,align=center},
  arrow/.style={->,thick,>={Stealth}}
]
  \node[startstop] (start) {Début};
  \node[io,below=of start] (input) {Lire $n$};
  \node[decision,below=of input] (test) {$n>1$ ?};
  \node[startstop,below left=of test] (again) {Continuer};
  \node[startstop,below right=of test] (stop) {Fin};
  \draw[arrow] (start)--(input);
  \draw[arrow] (input)--(test);
  \draw[arrow] (test)--node[above left]{oui}(again);
  \draw[arrow] (test)--node[above right]{non}(stop);
\end{tikzpicture}`
  },
  {
    id: 'molecule', title: 'Chemfig · molécule organique',
    source: String.raw`\chemfig{HO-*6(-=-(-OH)-(-CH_2CH_2NH_2)=-)}`
  },
  {
    id: 'surface3d', title: 'PGFPlots · surface 3D',
    source: String.raw`\begin{tikzpicture}
\begin{axis}[
  view={55}{30},
  xlabel={$x$},ylabel={$y$},zlabel={$z$},
  domain=-3:3,y domain=-3:3,
  samples=18,samples y=18,
  width=9cm,height=7cm
]
\addplot3[surf,shader=flat]
  {sin(deg(sqrt(x^2+y^2)))/(sqrt(x^2+y^2)+0.2)};
\end{axis}
\end{tikzpicture}`
  },
  {
    id: 'axes3d', title: 'TikZ 3D · repère spatial',
    source: String.raw`\tdplotsetmaincoords{70}{110}
\begin{tikzpicture}[tdplot_main_coords]
  \draw[->] (0,0,0)--(2.4,0,0) node[anchor=north east]{$x$};
  \draw[->] (0,0,0)--(0,2.4,0) node[anchor=north west]{$y$};
  \draw[->] (0,0,0)--(0,0,2.4) node[anchor=south]{$z$};
  \draw[thick] (0,0,0)--(1.5,1.4,1.8) node[above]{$\vec u$};
\end{tikzpicture}`
  }

];
