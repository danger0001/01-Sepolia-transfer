require('dotenv').config(); // 加载环境变量
const { Web3 } = require('web3'); // 使用解构赋值导入Web3库
const fs = require('fs'); // 导入文件系统模块

// 动态导入 p-limit 库
const pLimit = async () => {
    return (await import('p-limit')).default; // 使用动态导入获取 p-limit 的默认导出
};

// 初始化Web3实例和账户信息
const web3 = new Web3(process.env.RPC_URL); // 确保使用正确的构造函数调用方式
const account = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
const senderAddress = account.address;
const gasLimit = parseInt(process.env.GAS_LIMIT, 10);

// 从文件读取接收者信息并解析
const recipientsData = fs.readFileSync('recipients.txt', 'utf8').trim().split('\n');
const recipients = recipientsData.map(line => {
    const [address, amount] = line.split(' ');
    return { address, amount: web3.utils.toWei(amount, 'ether') }; // 确保金额转换为wei格式
});

// 验证接收者地址和金额的函数
function validateRecipients(recipients) {
    for (const recipient of recipients) {
        if (!web3.utils.isAddress(recipient.address)) {
            throw new Error(`无效的地址: ${recipient.address}`);
        }
        if (parseFloat(web3.utils.fromWei(recipient.amount, 'ether')) <= 0) {
            throw new Error(`无效的金额: ${recipient.amount}`);
        }
    }
}

// 获取当前 Gas Price，并增加一定比例以确保交易成功
async function getAdjustedGasPrice() {
    const gasPrice = await web3.eth.getGasPrice();
    return Math.ceil(Number(gasPrice) * 1.1); // 确保将 gasPrice 转换为数字并增加10%
}

// 发送交易的函数，处理 replacement transaction underpriced 错误
async function sendTransaction(to, value) {
    const nonce = await web3.eth.getTransactionCount(senderAddress); // 获取当前 nonce

    const adjustedGasPrice = await getAdjustedGasPrice(); // 获取调整后的 gas price

    const tx = {
        from: senderAddress,
        to: to,
        value: value,
        gas: gasLimit,
        gasPrice: adjustedGasPrice.toString(), // 确保 gasPrice 是字符串类型
        nonce: nonce,
    };

    try {
        const signedTx = await account.signTransaction(tx);
        return await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    } catch (error) {
        if (error.message.includes('replacement transaction underpriced')) {
            console.error(`交易失败到 ${to}: 交易被认为是替代交易价格过低，尝试增加Gas Price并重试。`);
            throw error; // 重新抛出错误以便后续处理，可能需要在外部捕获并重试逻辑。
        }
        console.error(`交易失败到 ${to}: ${error.message}`);
        throw error; // 重新抛出错误以便后续处理
    }
}

// 主函数，执行批量转账，使用顺序执行来确保每笔交易完成后再进行下一笔交易
(async () => {
    try {
        validateRecipients(recipients); // 验证接收者信息

        for (const recipient of recipients) {
            try {
                const receipt = await sendTransaction(recipient.address, recipient.amount);
                console.log(`从 ${senderAddress} 转账成功到 ${recipient.address}: ${receipt.transactionHash}`);
            } catch (error) {
                console.error(`从 ${senderAddress} 转账失败到 ${recipient.address}: ${error.message}`);
            }
        }

    } catch (error) {
        console.error(`验证失败: ${error.message}`);
    }
})();
