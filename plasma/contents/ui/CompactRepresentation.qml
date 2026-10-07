/*
    SPDX-License-Identifier: MIT

    Compact representation — status bar item.

    Sizing reality (Plasma 5.27, verified): inside the SYSTEM TRAY the
    container anchor-fills the plasmoid into a fixed icon-sized cell
    (systray's items/PlasmoidItem.qml: applet.anchors.fill = iconContainer)
    and Layout.minimumWidth is NOT honoured — wide content would paint
    over neighbouring icons. Battery/keyboard-layout solve this with
    badges inside the cell. Therefore two render modes, chosen by
    measurement (so DPI and panel changes stay correct):

    - "full" mode: icon + GNOME-format "34% / 45%" label — used when the
      content fits the space actually given (panel placement or the
      tray's "Scale icons to fit" mode)
    - "badge" mode (tray): the ollama icon fills the cell with the
      rounded SESSION percentage as a BadgeOverlay in the corner;
      without the icon the small percentage is centred in the cell.
      (Full numbers stay one click away in the popup, like GNOME.)

    Click: toggles the popup (battery-parity; the tray forwards clicks
    to the MouseArea covering the whole item).
*/

import QtQuick 2.15
import QtQuick.Layouts 1.15

import org.kde.plasma.core 2.1 as PlasmaCore
import org.kde.plasma.components 3.0 as PlasmaComponents3
import org.kde.plasma.plasmoid 2.0
import org.kde.plasma.workspace.components 2.0 as WorkspaceComponents

MouseArea {
    id: compactRoot

    property var applet

    hoverEnabled: true

    property bool wasExpanded
    onPressed: wasExpanded = Plasmoid.expanded
    onClicked: Plasmoid.expanded = !wasExpanded

    readonly property bool isError: applet.errorMessage !== ""
    readonly property bool hasData: applet.usageData != null
    readonly property bool cfgShowIcon: applet.cfgShowIcon

    readonly property var badgeSessionPct: hasData && applet.usageData.session_pct != null
        ? Math.round(applet.usageData.session_pct) : null

    // Full label mode: everything that needs room.
    readonly property bool fullMode:
        isError || !hasData || labelRow.implicitWidth <= width

    Layout.minimumWidth: fullMode ? labelRow.implicitWidth : PlasmaCore.Units.iconSizes.small
    Layout.preferredWidth: labelRow.implicitWidth
    Layout.minimumHeight: PlasmaCore.Units.iconSizes.smallMedium
    Layout.preferredHeight: Layout.minimumHeight

    // ------------------------------------------------------------------
    // Full mode: icon + label "34% / 45%" (GNOME parity), "—" or "!".
    // ------------------------------------------------------------------
    Row {
        id: labelRow
        visible: compactRoot.fullMode
        anchors.centerIn: parent
        spacing: PlasmaCore.Units.smallSpacing

        PlasmaCore.IconItem {
            id: labelIcon
            visible: compactRoot.cfgShowIcon
            width: PlasmaCore.Units.iconSizes.smallMedium
            height: PlasmaCore.Units.iconSizes.smallMedium
            source: compactRoot.isError
                ? "dialog-warning"
                : Qt.resolvedUrl("../images/ollama-icon.png")
        }

        PlasmaComponents3.Label {
            anchors.verticalCenter: parent.verticalCenter
            text: compactRoot.isError
                ? "!"
                : (compactRoot.hasData ? compactRoot.applet.compactLabel : "—")
            textFormat: Text.PlainText
            font.letterSpacing: 0.5
        }
    }

    // ------------------------------------------------------------------
    // Badge mode: icon-sized cell with the session percentage.
    // ------------------------------------------------------------------
    PlasmaCore.IconItem {
        id: badgeIcon
        visible: !compactRoot.fullMode && compactRoot.cfgShowIcon
        anchors.fill: parent
        anchors.margins: PlasmaCore.Units.smallSpacing
        source: Qt.resolvedUrl("../images/ollama-icon.png")
    }

    PlasmaComponents3.Label {
        id: badgeText
        visible: !compactRoot.fullMode && compactRoot.cfgShowIcon
                 && compactRoot.badgeSessionPct != null
        anchors.bottom: parent.bottom
        anchors.right: parent.right
        text: compactRoot.badgeSessionPct + "%"
        font.pixelSize: compactRoot.height >= 30
            ? Math.round(compactRoot.height * 0.30)
            : PlasmaCore.Units.fontMetrics.font.pixelSize * 0.8
        font.bold: true
    }

    PlasmaComponents3.Label {
        visible: !compactRoot.fullMode && !compactRoot.cfgShowIcon
        anchors.centerIn: parent
        text: compactRoot.badgeSessionPct != null ? compactRoot.badgeSessionPct + "%" : "…"
        font.pixelSize: Math.round(PlasmaCore.Units.gridUnit * 0.8)
        font.bold: true
    }
}