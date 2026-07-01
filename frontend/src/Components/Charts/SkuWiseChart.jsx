import React from 'react'
import { C } from '../../App'
import { BarChart, PiecewiseColorLegend, useAnimate, useAnimateBar, useDrawingArea } from '@mui/x-charts'
import { styled, useTheme } from '@mui/material';
import { interpolateObject } from '@mui/x-charts-vendor/d3-interpolate';

export default function SkuWiseChart({ topSkus }) {
    return (
        <BarChart
            dataset={topSkus.map(s => ({ sku: s.sku || "—", count: s.count, qty: s.total_qty ?? s.count }))}
            layout="horizontal"
            yAxis={[{
                scaleType: "band", dataKey: "sku",
                tickLabelStyle: { fontSize: 10, fill: C.gray500 },
            }]}
            xAxis={[{
                id: "color",
                colorMap: {
                    type: 'piecewise',
                    thresholds: [50, 85],
                    colors: [C.red, C.blue, C.amber],
                },
                tickLabelStyle: { fontSize: 9, fill: C.gray400 }
            }]}
            series={[{
                id: "count",
                dataKey: "count",
                label: "Orders",
                stack: 'order count',
                valueFormatter: (value) => value,
                barLabel: (v) => `${v.value}`,
            }]}
            height={Math.max(180, topSkus.length * 30 + 40)}
            borderRadius={8}
            margin={{ left: 90, bottom: 28, right: 20, top: 8 }}
            slots={{
                legend: PiecewiseColorLegend,
                barLabel: BarLabelAtBase,
                bar: BarShadedBackground,
            }}
            slotProps={{
                legend: {
                    axisDirection: 'x',
                    markType: 'square',
                    labelPosition: 'inline-start',
                    labelFormatter: ({ index }) => {
                        if (index === 0) {
                            return '3rd Highest Orders';
                        }
                        if (index === 1) {
                            return 'Medium Highest Orders';
                        }
                        return 'Highest Orders';
                    },
                },
            }}
            showToolbar={true}

        />
    )
}


export function BarShadedBackground(props) {
    const {
        ownerState,
        skipAnimation,
        id,
        dataIndex,
        xOrigin,
        yOrigin,
        seriesId,
        ...other
    } = props;
    const theme = useTheme();

    const animatedProps = useAnimateBar(props);
    const { width } = useDrawingArea();
    return (
        <React.Fragment>
            <rect
                {...other}
                fill={(theme.vars || theme).palette.text.primary}
                opacity={theme.palette.mode === 'dark' ? 0.05 : 0.1}
                x={other.x}
                width={width}
            />
            <rect
                {...other}
                filter={ownerState.isHighlighted ? 'brightness(120%)' : undefined}
                opacity={ownerState.isFaded ? 0.3 : 1}
                data-highlighted={ownerState.isHighlighted || undefined}
                data-faded={ownerState.isFaded || undefined}
                {...animatedProps}
            />
        </React.Fragment>
    );
}

const Text = styled('text')(({ theme }) => ({
    ...theme?.typography?.body2,
    stroke: 'none',
    fill: (theme.vars || theme).palette.common.white,
    transition: 'opacity 0.2s ease-in, fill 0.2s ease-in',
    textAnchor: 'start',
    dominantBaseline: 'central',
    pointerEvents: 'none',
    fontWeight: 600,
}));

function BarLabelAtBase(props) {
    const {
        seriesId,
        dataIndex,
        color,
        isFaded,
        isHighlighted,
        classes,
        xOrigin,
        yOrigin,
        x,
        y,
        width,
        height,
        layout,
        skipAnimation,
        ...otherProps
    } = props;

    const animatedProps = useAnimate(
        { x: xOrigin + 8, y: y + height / 2 },
        {
            initialProps: { x: xOrigin, y: y + height / 2 },
            createInterpolator: interpolateObject,
            transformProps: (p) => p,
            applyProps: (element, p) => {
                element.setAttribute('x', p.x.toString());
                element.setAttribute('y', p.y.toString());
            },
            skip: skipAnimation,
        },
    );

    return <Text {...otherProps} {...animatedProps} />;
}