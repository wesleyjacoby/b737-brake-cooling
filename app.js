const weightInput = document.getElementById("weightKg");
const oatInput = document.getElementById("oatC");
const speedInput = document.getElementById("speedKias");
const altInput = document.getElementById("pressureAltFt");
const reverseThrustInput = document.getElementById("reverseThrust");
const brakeTypeInput = document.getElementById("brakeType");

const resultLabel = document.getElementById("resultLabel");
const resultValue = document.getElementById("resultValue");
const resultUnit = document.getElementById("resultUnit");

const referenceEnergyValue = document.getElementById("referenceEnergyValue");
const adjustedEnergyValue = document.getElementById("adjustedEnergyValue");
const btmsValue = document.getElementById("btmsValue");
const zoneValue = document.getElementById("zoneValue");

const statusBox = document.getElementById("statusBox");
const detailsGrid = document.getElementById("detailsGrid");

const calcBtn = document.getElementById("calcBtn");
const clearBtn = document.getElementById("clearBtn");

function setStatus(message, type = "neutral") {
	statusBox.textContent = message;
	statusBox.className = "status";

	if (type === "error") {
		statusBox.classList.add("error");
	} else if (type === "ok") {
		statusBox.classList.add("ok");
	}
}

function formatNumber(value, decimals = 1) {
	return Number(value).toFixed(decimals);
}

function conservativeRoundUpToTenth(value) {
	return Math.ceil(value * 10) / 10;
}

function findBounds(axis, value) {
	if (value < axis[0] || value > axis[axis.length - 1]) {
		throw new Error(
			`Value ${value} is outside the supported range ${axis[0]} to ${axis[axis.length - 1]}.`,
		);
	}

	for (let i = 0; i < axis.length; i++) {
		if (value === axis[i]) {
			return {
				low: axis[i],
				high: axis[i],
				ratio: 0,
			};
		}

		if (value < axis[i]) {
			const low = axis[i - 1];
			const high = axis[i];

			return {
				low,
				high,
				ratio: (value - low) / (high - low),
			};
		}
	}

	const last = axis[axis.length - 1];
	return {
		low: last,
		high: last,
		ratio: 0,
	};
}

function lerp(a, b, t) {
	return a + (b - a) * t;
}

function getCell(weight, oat, speed, alt) {
	return TABLE[weight][oat][speed][alt];
}

function interpolate4D(weightT, oatC, speedKias, altT) {
	const w = findBounds(AXES.weights, weightT);
	const o = findBounds(AXES.oats, oatC);
	const s = findBounds(AXES.speeds, speedKias);
	const a = findBounds(AXES.alts, altT);

	const weightResults = [w.low, w.high].map((weight) => {
		const oatResults = [o.low, o.high].map((oat) => {
			const speedResults = [s.low, s.high].map((speed) => {
				const lowAltValue = getCell(weight, oat, speed, a.low);
				const highAltValue = getCell(weight, oat, speed, a.high);

				if (a.low === a.high) {
					return lowAltValue;
				}

				return lerp(lowAltValue, highAltValue, a.ratio);
			});

			if (s.low === s.high) {
				return speedResults[0];
			}

			return lerp(speedResults[0], speedResults[1], s.ratio);
		});

		if (o.low === o.high) {
			return oatResults[0];
		}

		return lerp(oatResults[0], oatResults[1], o.ratio);
	});

	const finalValue =
		w.low === w.high
			? weightResults[0]
			: lerp(weightResults[0], weightResults[1], w.ratio);

	return {
		value: finalValue,
		bounds: { w, o, s, a },
	};
}

function interpolateLine(xAxis, yAxis, xValue) {
	if (xAxis.length !== yAxis.length) {
		throw new Error("Interpolation arrays must be the same length.");
	}

	if (xValue < xAxis[0] || xValue > xAxis[xAxis.length - 1]) {
		throw new Error(
			`Value ${formatNumber(xValue, 1)} is outside the supported adjustment range ${xAxis[0]} to ${xAxis[xAxis.length - 1]}.`,
		);
	}

	for (let i = 0; i < xAxis.length; i++) {
		if (xValue === xAxis[i]) {
			return yAxis[i];
		}

		if (xValue < xAxis[i]) {
			const x0 = xAxis[i - 1];
			const x1 = xAxis[i];
			const y0 = yAxis[i - 1];
			const y1 = yAxis[i];
			const ratio = (xValue - x0) / (x1 - x0);

			return lerp(y0, y1, ratio);
		}
	}

	return yAxis[yAxis.length - 1];
}

function calculateAdjustedBrakeEnergy(referenceEnergy, reverseThrustKey) {
	const config = RTO_ADJUSTMENTS[reverseThrustKey];

	if (!config) {
		throw new Error("Invalid reverse thrust selection.");
	}

	return interpolateLine(
		config.referenceEnergy,
		config.adjustedEnergy,
		referenceEnergy,
	);
}

function calculateCoolingTime(schedule, adjustedEnergy) {
	const cautionStart = schedule.cautionZoneStartsAt;
	const fuseStart = schedule.fusePlugMeltZoneStartsAt;

	if (adjustedEnergy >= fuseStart) {
		return {
			zone: "fusePlugMelt",
			zoneLabel: "Fuse plug melt zone",
			btmsEquivalent: `${schedule.btmsBreakpoints[schedule.btmsBreakpoints.length - 1]} and above`,
			coolingTimeMinutes: null,
			coolingTimeLabel: "No timed value shown in this band",
			inflightNote: schedule.inflight.fusePlugMelt,
			groundNote: schedule.ground.fusePlugMelt,
		};
	}

	if (adjustedEnergy >= cautionStart) {
		return {
			zone: "caution",
			zoneLabel: "Caution zone",
			btmsEquivalent: `${schedule.btmsBreakpoints[schedule.btmsBreakpoints.length - 2]} to ${schedule.btmsBreakpoints[schedule.btmsBreakpoints.length - 1]}`,
			coolingTimeMinutes: null,
			coolingTimeLabel: "No timed value shown in this band",
			inflightNote: schedule.inflight.caution,
			groundNote: schedule.ground.caution,
		};
	}

	const energyAxis = schedule.adjustedEnergyBreakpoints.slice(0, 7);
	const btmsAxis = schedule.btmsBreakpoints.slice(0, 7);
	const coolingEnergyAxis = energyAxis.slice(1); // timed points only
	const coolingAxis = schedule.groundCoolingMinutes;

	if (adjustedEnergy <= energyAxis[0]) {
		return {
			zone: "normal",
			zoneLabel: "Normal range",
			btmsEquivalent: `up to ${btmsAxis[0]}`,
			coolingTimeMinutes: 0,
			coolingTimeLabel: "No special cooling time required",
			inflightNote: schedule.inflight.normal,
			groundNote: schedule.ground.normal,
		};
	}

	// Handle the narrow gap between the last timed point and the caution band.
	// Example: steel 32.0 to <33.0, carbon 29.4 to <30.0
	if (adjustedEnergy > coolingEnergyAxis[coolingEnergyAxis.length - 1]) {
		return {
			zone: "caution",
			zoneLabel: "Caution zone",
			btmsEquivalent: `${btmsAxis[btmsAxis.length - 1]} to ${schedule.btmsBreakpoints[schedule.btmsBreakpoints.length - 2]}`,
			coolingTimeMinutes: null,
			coolingTimeLabel: "No timed value shown in this band",
			inflightNote: schedule.inflight.caution,
			groundNote: schedule.ground.caution,
		};
	}

	const btmsInterpolated = interpolateLine(
		energyAxis,
		btmsAxis,
		adjustedEnergy,
	);
	const coolingTimeInterpolated = interpolateLine(
		coolingEnergyAxis,
		coolingAxis,
		adjustedEnergy,
	);

	return {
		zone: "normal",
		zoneLabel: "Normal range",
		btmsEquivalent: formatNumber(btmsInterpolated, 1),
		coolingTimeMinutes: coolingTimeInterpolated,
		coolingTimeLabel: `${formatNumber(coolingTimeInterpolated, 1)} min`,
		inflightNote: schedule.inflight.normal,
		groundNote: schedule.ground.normal,
	};
}

function updateSummaryCards({
	referenceEnergy = "—",
	adjustedEnergy = "—",
	btmsEquivalent = "—",
	zone = "—",
}) {
	referenceEnergyValue.textContent = referenceEnergy;
	adjustedEnergyValue.textContent = adjustedEnergy;
	btmsValue.textContent = btmsEquivalent;
	zoneValue.textContent = zone;
}

function updateHero({
	label = "Cooling result",
	value = "—",
	unit = "Enter the inputs and tap Calculate.",
}) {
	resultLabel.textContent = label;
	resultValue.textContent = value;
	resultUnit.textContent = unit;
}

function updateDetails({
	weightBracket = "—",
	oatBracket = "—",
	speedBracket = "—",
	altitudeBracket = "—",
	rawReferenceValue = "—",
	displayedReferenceValue = "—",
	reverseThrust = "—",
	brakeType = "—",
	adjustedBrakeEnergy = "—",
	btmsEquivalent = "—",
	coolingTime = "—",
	zone = "—",
	inflightNote = "—",
	groundNote = "—",
}) {
	detailsGrid.innerHTML = `
		<div><strong>Weight bracket</strong><span>${weightBracket}</span></div>
		<div><strong>OAT bracket</strong><span>${oatBracket}</span></div>
		<div><strong>Speed bracket</strong><span>${speedBracket}</span></div>
		<div><strong>Altitude bracket</strong><span>${altitudeBracket}</span></div>
		<div><strong>Raw reference energy</strong><span>${rawReferenceValue}</span></div>
		<div><strong>Displayed reference energy</strong><span>${displayedReferenceValue}</span></div>
		<div><strong>Reverse thrust</strong><span>${reverseThrust}</span></div>
		<div><strong>Brake type</strong><span>${brakeType}</span></div>
		<div><strong>Adjusted brake energy</strong><span>${adjustedBrakeEnergy}</span></div>
		<div><strong>BTMS equivalent</strong><span>${btmsEquivalent}</span></div>
		<div><strong>Cooling time</strong><span>${coolingTime}</span></div>
		<div><strong>Zone</strong><span>${zone}</span></div>
		<div><strong>Inflight note</strong><span>${inflightNote}</span></div>
		<div><strong>Ground note</strong><span>${groundNote}</span></div>
	`;
}

function clearOutputs() {
	updateHero({
		label: "Cooling result",
		value: "—",
		unit: "Enter the inputs and tap Calculate.",
	});

	updateSummaryCards({});
	setStatus("Enter the inputs and tap Calculate.");
	updateDetails({});
}

function readInputs() {
	const weightKg = Number(weightInput.value);
	const oatC = Number(oatInput.value);
	const speedKias = Number(speedInput.value);
	const pressureAltFt = Number(altInput.value);
	const reverseThrust = reverseThrustInput.value;
	const brakeType = brakeTypeInput.value;

	if (
		!weightInput.value ||
		!oatInput.value ||
		!speedInput.value ||
		!altInput.value
	) {
		throw new Error("Please complete all required input fields.");
	}

	if (
		Number.isNaN(weightKg) ||
		Number.isNaN(oatC) ||
		Number.isNaN(speedKias) ||
		Number.isNaN(pressureAltFt)
	) {
		throw new Error("One or more inputs are invalid.");
	}

	if (!RTO_ADJUSTMENTS[reverseThrust]) {
		throw new Error("Please select a valid reverse thrust option.");
	}

	if (!COOLING_SCHEDULES[brakeType]) {
		throw new Error("Please select a valid brake type.");
	}

	return {
		weightT: weightKg / 1000,
		oatC,
		speedKias,
		altT: pressureAltFt / 1000,
		reverseThrust,
		brakeType,
	};
}

function getReverseThrustLabel(value) {
	return value === "detent_reverse"
		? "Two-engine detent reverse thrust"
		: "No reverse thrust";
}

function getBrakeTypeLabel(value) {
	return value === "carbon"
		? "Category N carbon brakes"
		: "Category C steel brakes";
}

function calculateBrakeCooling() {
	try {
		const { weightT, oatC, speedKias, altT, reverseThrust, brakeType } =
			readInputs();

		const referenceResult = interpolate4D(weightT, oatC, speedKias, altT);
		const displayedReferenceEnergy = conservativeRoundUpToTenth(
			referenceResult.value,
		);

		const adjustedBrakeEnergy = calculateAdjustedBrakeEnergy(
			displayedReferenceEnergy,
			reverseThrust,
		);

		const coolingResult = calculateCoolingTime(
			COOLING_SCHEDULES[brakeType],
			adjustedBrakeEnergy,
		);

		if (coolingResult.coolingTimeMinutes === null) {
			updateHero({
				label: "Cooling result",
				value: coolingResult.zoneLabel,
				unit: coolingResult.coolingTimeLabel,
			});
		} else if (coolingResult.coolingTimeMinutes === 0) {
			updateHero({
				label: "Cooling result",
				value: "No special cooling",
				unit: "No special cooling time required",
			});
		} else {
			updateHero({
				label: "Cooling time",
				value: formatNumber(coolingResult.coolingTimeMinutes, 1),
				unit: "minutes",
			});
		}

		updateSummaryCards({
			referenceEnergy: `${formatNumber(displayedReferenceEnergy, 1)} M ft-lb/brake`,
			adjustedEnergy: `${formatNumber(adjustedBrakeEnergy, 1)} M ft-lb/brake`,
			btmsEquivalent: coolingResult.btmsEquivalent,
			zone: coolingResult.zoneLabel,
		});

		const statusMessage =
			coolingResult.coolingTimeMinutes === null
				? `Reference ${formatNumber(displayedReferenceEnergy, 1)} M ft-lb/brake • Adjusted ${formatNumber(adjustedBrakeEnergy, 1)} M ft-lb/brake • ${coolingResult.zoneLabel}.`
				: `Reference ${formatNumber(displayedReferenceEnergy, 1)} M ft-lb/brake • Adjusted ${formatNumber(adjustedBrakeEnergy, 1)} M ft-lb/brake • Cooling time ${formatNumber(coolingResult.coolingTimeMinutes, 1)} min.`;

		setStatus(statusMessage, "ok");

		updateDetails({
			weightBracket: `${referenceResult.bounds.w.low.toFixed(0)} to ${referenceResult.bounds.w.high.toFixed(0)} x1000 kg`,
			oatBracket: `${referenceResult.bounds.o.low.toFixed(0)} to ${referenceResult.bounds.o.high.toFixed(0)} °C`,
			speedBracket: `${referenceResult.bounds.s.low.toFixed(0)} to ${referenceResult.bounds.s.high.toFixed(0)} KIAS`,
			altitudeBracket: `${referenceResult.bounds.a.low.toFixed(0)} to ${referenceResult.bounds.a.high.toFixed(0)} x1000 ft`,
			rawReferenceValue: `${formatNumber(referenceResult.value, 3)} M ft-lb/brake`,
			displayedReferenceValue: `${formatNumber(displayedReferenceEnergy, 1)} M ft-lb/brake`,
			reverseThrust: getReverseThrustLabel(reverseThrust),
			brakeType: getBrakeTypeLabel(brakeType),
			adjustedBrakeEnergy: `${formatNumber(adjustedBrakeEnergy, 1)} M ft-lb/brake`,
			btmsEquivalent: coolingResult.btmsEquivalent,
			coolingTime: coolingResult.coolingTimeLabel,
			zone: coolingResult.zoneLabel,
			inflightNote: coolingResult.inflightNote,
			groundNote: coolingResult.groundNote,
		});
	} catch (error) {
		updateHero({
			label: "Cooling result",
			value: "—",
			unit: "Enter the inputs and tap Calculate.",
		});
		updateSummaryCards({});
		setStatus(error.message, "error");
		updateDetails({});
	}
}

calcBtn.addEventListener("click", calculateBrakeCooling);

clearBtn.addEventListener("click", () => {
	weightInput.value = "";
	oatInput.value = "";
	speedInput.value = "";
	altInput.value = "";
	reverseThrustInput.value = "no_reverse";
	brakeTypeInput.value = "steel";
	clearOutputs();
});

clearOutputs();
