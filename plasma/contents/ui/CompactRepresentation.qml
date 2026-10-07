/*
    SPDX-License-Identifier: MIT

    Compact representation — lives in the status bar (system tray).

    Same format as the GNOME extension's top-bar label: an optional
    ollama icon (configurable; swapped for a warning glyph on error)
    and the "34% / 45%" usage label ("34%" when weekly usage is
    unavailable, "—" when no data has arrived yet, "!" on error).

    Click handling is left to the system tray, which opens the full
    representation (the menu) — matches how the tray hosts battery etc.
*/

import QtQuick 2.15
import QtQuick.Layouts 1.15

import org.kde.plasma.core 2.1 as PlasmaCore
import org.kde.plasma.components 3.0 as PlasmaComponents3
import org.kde.plasma.plasmoid 2.0

Item {
    id: compactRoot

    property var applet

    readonly property bool isError: applet.errorMessage !== ""
    readonly property bool showLabel: applet.usageData != null || isError

    Layout.minimumWidth: mainLayout.implicitWidth
    Layout.minimumHeight: mainLayout.implicitHeight
    Layout.maximumWidth: Layout.minimumWidth
    Layout.maximumHeight: Layout.minimumHeight

    RowLayout {
        id: mainLayout
        anchors.centerIn: parent
        spacing: PlasmaCore.Units.smallSpacing

        PlasmaCore.IconItem {
            visible: compactRoot.applet.cfgShowIcon
            Layout.preferredWidth: PlasmaCore.Units.iconSizes.smallMedium
            Layout.preferredHeight: PlasmaCore.Units.iconSizes.smallMedium
            source: compactRoot.isError
                ? "dialog-warning"
                : Qt.resolvedUrl("../images/ollama-icon.png")
        }

        PlasmaComponents3.Label {
            visible: compactRoot.showLabel
            text: compactRoot.isError
                ? "!"
                : (compactRoot.applet.usageData != null
                   ? compactRoot.applet.compactLabel
                   : "—")
            textFormat: Text.PlainText
            font.letterSpacing: 0.5
        }
    }
}